import Papa from 'papaparse';

// ==========================================
// 1. Interfaces & Types
// ==========================================

export interface CautionOrder {
  startOhe: string;
  endOhe: string;
  speedLimit: number;
}

export type TrainType = 'passenger' | 'goods';

export interface BrakeTestResult {
  type: 'BFT' | 'BPT';
  status: 'proper' | 'improper' | 'not_performed';
  startSpeed: number;
  lowestSpeed: number;
  dropAmount: number;
  location: string;
  timestamp: string;
  details?: string;
}

export interface Stoppage {
  location: string;
  latitude: number;
  longitude: number;
  arrivalTime: string;
  departureTime: string;
  durationMin: number;
  isSignal: boolean;
}

export interface HaltApproachViolation {
  haltLocation: string;
  checkpoint: string;    
  limit: number;
  actualSpeed: number;
  timestamp: string;
}

export interface AnalysisResult {
  location: string;
  latitude: number;
  longitude: number;
  logging_time: string;
  speed_kmph: number | null;
  limit_applied: number | null;
  status: 'ok' | 'warning' | 'violation'; 
  matched: boolean;
  source: 'OHE' | 'Signal';
  chainage?: number; // Added for debugging/reference
}

export interface AnalysisSummary {
  total_structures: number;
  matched_structures: number;
  unmatched_structures: number;
  match_rate: number;
  avg_speed: number;
  max_speed: number;
  min_speed: number;
  violation_count: number;
  warning_count: number;
  config_mps: number;
  train_type: TrainType;
  stoppages: Stoppage[];
  brake_tests: BrakeTestResult[];
  halt_approach_violations: HaltApproachViolation[];
}

// Internal Interface for Parsed RTIS Data
interface GPSPoint {
  idx: number;
  lat: number;
  lon: number;
  speed: number;
  time: Date;
  timeStr: string;
  heading: number; // Added Heading
}

// ==========================================
// 2. Math & Geometry Helpers (UPDATED)
// ==========================================

const EARTH_RADIUS = 6371000.0;
const TO_RAD = Math.PI / 180;
const TO_DEG = 180 / Math.PI;

function cleanCoord(val: any): number {
  if (typeof val === 'number') return val;
  if (!val) return NaN;
  const clean = val.toString().replace(/["'°NESW\s]/g, ''); 
  return parseFloat(clean);
}

function toRad(deg: number) { return deg * TO_RAD; }
function toDeg(rad: number) { return rad * TO_DEG; }

/**
 * Calculates Haversine distance in meters
 */
function getDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS * c;
}

/**
 * Calculates Bearing (Heading) between two points (0-360)
 */
function getBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
            Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  const brng = Math.atan2(y, x);
  return (toDeg(brng) + 360) % 360;
}

/**
 * Convert OHE string "962/10" to linear meters.
 * Assumes 60m span between masts.
 */
function oheToMeters(oheStr: string): number {
  if (!oheStr) return 0;
  const clean = oheStr.replace(/[^\d\/]/g, '');
  
  if (clean.includes('/')) {
    const [km, pole] = clean.split('/').map(Number);
    // KM * 1000 + Pole * 60m (Approx standard span)
    return (km * 1000) + (pole * 60);
  }
  
  const val = Number(clean);
  return isNaN(val) ? 0 : val * 1000;
}

/**
 * Vector Projection Logic to Snap GPS to Track Line
 */
function getProjectedChainage(
  trainLat: number, trainLon: number, trainHeading: number,
  segStartLat: number, segStartLon: number, segStartMeters: number,
  segEndLat: number, segEndLon: number
): number | null {

  // 1. Heading Check (Parallel Track Fix)
  // Calculate bearing of the OHE segment itself
  const segBearing = getBearing(segStartLat, segStartLon, segEndLat, segEndLon);
  
  let diff = Math.abs(segBearing - trainHeading);
  if (diff > 180) diff = 360 - diff;
  
  // If train heading differs by > 45 degrees, it's likely on the other line or moving backwards
  if (diff > 45) return null; 

  // 2. Vector Projection
  const Ax = segStartLat, Ay = segStartLon;
  const Bx = segEndLat,   By = segEndLon;
  const Px = trainLat,    Py = trainLon;

  const AB_x = Bx - Ax;
  const AB_y = By - Ay;
  const AP_x = Px - Ax;
  const AP_y = Py - Ay;

  const dot = AP_x * AB_x + AP_y * AB_y;
  const lenSq = AB_x * AB_x + AB_y * AB_y;

  let t = -1;
  if (lenSq !== 0) t = dot / lenSq;

  // If projected point is outside the segment (with small buffer), reject
  if (t < -0.1 || t > 1.1) return null;

  // Calculate Linear Distance
  const segLen = getDistance(segStartLat, segStartLon, segEndLat, segEndLon);
  return segStartMeters + (t * segLen);
}


// ==========================================
// 3. New Logic: Precise Speed Limit Check
// ==========================================

function getApplicableLimitLinear(
  currentChainage: number,
  globalMPS: number, 
  cautionOrders: CautionOrder[],
  trainLength: number
): number {
  let limit = globalMPS;

  for (const co of cautionOrders) {
    const startM = oheToMeters(co.startOhe);
    const endM = oheToMeters(co.endOhe);
    
    // Normalize range (ensure start < end)
    const zoneStart = Math.min(startM, endM);
    const zoneEnd = Math.max(startM, endM);

    // ** CORE LOGIC FIX **
    // The restriction applies from Start OHE until the LAST COACH clears the End OHE.
    // So valid range is: [Start, End + TrainLength]
    const effectiveEnd = zoneEnd + trainLength;

    if (currentChainage >= zoneStart && currentChainage <= effectiveEnd) {
      if (co.speedLimit < limit) {
        limit = co.speedLimit;
      }
    }
  }
  return limit;
}


// ==========================================
// 4. Data Parsing Helpers
// ==========================================

class GridIndex {
  private grid: Map<string, Array<{ idx: number; lat: number; lon: number }>>;
  private gridDeg: number;
  constructor(gridDeg = 0.01) { this.grid = new Map(); this.gridDeg = gridDeg; }
  private cell(lat: number, lon: number) { return `${Math.floor(lat/this.gridDeg)},${Math.floor(lon/this.gridDeg)}`; }
  insert(idx: number, lat: number, lon: number) {
    const key = this.cell(lat, lon);
    if (!this.grid.has(key)) this.grid.set(key, []);
    this.grid.get(key)!.push({ idx, lat, lon });
  }
  query(lat: number, lon: number) {
    const cx = Math.floor(lat / this.gridDeg);
    const cy = Math.floor(lon / this.gridDeg);
    const candidates: Array<{ idx: number; lat: number; lon: number }> = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${cx + dx},${cy + dy}`;
        if (this.grid.has(key)) candidates.push(...this.grid.get(key)!);
      }
    }
    return candidates;
  }
}

function parseCSV(content: string): Array<Record<string, string>> {
  const lines = content.split("\n").filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = values[i] || ""));
    return row;
  });
}

function findColumn(data: Array<Record<string, string>>, names: string[]): string | null {
  if (data.length === 0) return null;
  const headers = Object.keys(data[0]);
  for (const name of names) {
    const found = headers.find((h) => h.toLowerCase() === name.toLowerCase() || h.toLowerCase().replace(/[^a-z]/g, '') === name.toLowerCase());
    if (found) return found;
  }
  return null;
}

// ==========================================
// 5. CORE ANALYZER (Refactored)
// ==========================================

export async function analyzeData(
  rtisFile: File,
  oheFile: File | null, 
  signalsFile: File | null, 
  maxDistance: number,
  globalMPS: number,
  cautionOrders: CautionOrder[],
  trainType: TrainType,
  departureTime?: string,
  arrivalTime?: string
): Promise<{ summary: AnalysisSummary; results: AnalysisResult[]; signals: AnalysisResult[] }> {
  
  // --- 1. Parse Inputs ---
  const rtisContent = await rtisFile.text();
  const rtisDataRaw = parseCSV(rtisContent);
  const oheContent = oheFile ? await oheFile.text() : "";
  const oheDataRaw = oheContent ? parseCSV(oheContent) : [];
  const signalsContent = signalsFile ? await signalsFile.text() : "";
  const signalsDataRaw = signalsContent ? parseCSV(signalsContent) : [];

  const rtisLatCol = findColumn(rtisDataRaw, ["Latitude", "lat", "gps_lat"]);
  const rtisLonCol = findColumn(rtisDataRaw, ["Longitude", "lon", "long", "gps_long"]);
  const rtisTimeCol = findColumn(rtisDataRaw, ["Logging Time", "LoggingTime", "timestamp", "date", "time"]);
  const rtisSpeedCol = findColumn(rtisDataRaw, ["Speed", "speed", "speed_kmph", "velocity"]);

  if (!rtisLatCol || !rtisLonCol || !rtisTimeCol || !rtisSpeedCol) throw new Error("RTIS file missing critical columns");

  // --- 2. Process RTIS Data (Calculate Headings) ---
  const depTimeMs = departureTime ? new Date(departureTime).getTime() : 0;
  const arrTimeMs = arrivalTime ? new Date(arrivalTime).getTime() : Infinity;

  // Convert raw RTIS to typed objects
  let tempRtis: GPSPoint[] = rtisDataRaw
    .map((row, idx) => {
      let lat = cleanCoord(row[rtisLatCol]);
      let lon = cleanCoord(row[rtisLonCol]);
      if (lat > 60 && lon < 40) { [lat, lon] = [lon, lat]; } // Auto-fix flipped coords
      
      const speedRaw = parseFloat(row[rtisSpeedCol]);
      const timeStr = row[rtisTimeCol];
      const timeDate = timeStr ? new Date(timeStr) : new Date(0);
      
      return {
        idx, lat, lon,
        speed: !isNaN(speedRaw) ? Math.round(speedRaw) : 0,
        time: timeDate,
        timeStr,
        heading: 0 // Will calc next
      };
    })
    .filter(p => !isNaN(p.lat) && !isNaN(p.lon) && p.lat !== 0 && p.lon !== 0)
    .filter(p => p.time.getTime() >= depTimeMs && p.time.getTime() <= arrTimeMs)
    .sort((a, b) => a.time.getTime() - b.time.getTime());

  // Calculate Headings (Bearing between P[i] and P[i+1])
  for(let i = 0; i < tempRtis.length - 1; i++) {
    const dist = getDistance(tempRtis[i].lat, tempRtis[i].lon, tempRtis[i+1].lat, tempRtis[i+1].lon);
    if(dist > 5) { // Only update heading if moved > 5m to reduce jitter
        tempRtis[i].heading = getBearing(tempRtis[i].lat, tempRtis[i].lon, tempRtis[i+1].lat, tempRtis[i+1].lon);
    } else if (i > 0) {
        tempRtis[i].heading = tempRtis[i-1].heading; // Maintain previous if stopped
    }
  }
  // Fill last point
  if(tempRtis.length > 0) tempRtis[tempRtis.length-1].heading = tempRtis[tempRtis.length-2]?.heading || 0;

  const rtisCleaned = tempRtis;
  const trainLength = trainType === 'goods' ? 700 : 600; 

  // --- 3. Process OHE (Master Data) ---
  // We need to sort OHE data to create a "Track Line" for snapping
  const isOheMaster = oheDataRaw.length > 0;
  let masterDataRaw = isOheMaster ? oheDataRaw : signalsDataRaw;
  
  const masterLatCol = findColumn(masterDataRaw, ["Latitude", "latitude", "lat", "gps_lat", "y"]);
  const masterLonCol = findColumn(masterDataRaw, ["Longitude", "longitude", "lon", "long", "gps_long", "x"]);
  const masterLabelCol = findColumn(masterDataRaw, ["OHEMas", "OHE", "pole", "Signal", "Name", "Station", "Label", "Asset"]) || "Location";

  if (!masterLatCol || !masterLonCol) throw new Error("Master file missing Latitude/Longitude columns");

  // Create Grid for Fast Lookup
  const rtisMatchGrid = new GridIndex(0.01);
  rtisCleaned.forEach(p => rtisMatchGrid.insert(p.idx, p.lat, p.lon));

  // --- 4. Matching Logic & Violation Detection ---
  
  let firstMatchedRtisIndex = Infinity; 
  let lastMatchedRtisIndex = -1;

  const processDataset = (data: any[], type: 'OHE' | 'Signal', latCol: string, lonCol: string, labelCol: string) => {
      const out: AnalysisResult[] = [];
      const threshold = (maxDistance && maxDistance > 0) ? maxDistance : 500;

      // Helper to find next valid OHE for segment creation
      // We assume data is somewhat sorted or we look ahead
      
      for (let i = 0; i < data.length; i++) {
          const row = data[i];
          let lat = cleanCoord(row[latCol]);
          let lon = cleanCoord(row[lonCol]);
          const locName = row[labelCol] || "Unknown";
          
          if (isNaN(lat) || isNaN(lon)) continue;
          if (lat > 60 && lon < 40) { [lat, lon] = [lon, lat]; }

          // A. Find best GPS Candidate (Spatial filter first)
          const candidates = rtisMatchGrid.query(lat, lon);
          let bestP: GPSPoint | null = null;
          let bestDist = Infinity;
          
          candidates.forEach(c => {
              const rtisPt = rtisCleaned[c.idx];
              const dist = getDistance(lat, lon, rtisPt.lat, rtisPt.lon);
              
              // NEW: Directional Filter (Rough check)
              // We refine this later with projection, but if heading is wildly off, 
              // it's likely a train on the return leg on parallel track.
              // (Skipped here to ensure we at least find a "nearest" point, 
              // precise check happens in Limit calculation)
              
              if (dist < bestDist) { 
                  bestDist = dist; 
                  bestP = rtisPt; 
              }
          });

          let speed: number | null = null;
          let limitApplied: number | null = null;
          let status: 'ok' | 'warning' | 'violation' = 'ok';
          let matched = false;
          let calculatedChainage = 0;

          if (bestP && bestDist <= threshold) {
              matched = true;
              speed = (bestP as GPSPoint).speed;
              
              const pIdx = (bestP as GPSPoint).idx;
              if (pIdx < firstMatchedRtisIndex) firstMatchedRtisIndex = pIdx;
              if (pIdx > lastMatchedRtisIndex) lastMatchedRtisIndex = pIdx;

              if (type === 'OHE') {
                  const oheMeters = oheToMeters(locName);
                  
                  // B. Precise Snapping & Limit Logic
                  // We attempt to form a segment with the next OHE structure
                  // to calculate exact chainage of the train.
                  let snappedMeters: number | null = null;
                  
                  // Look ahead for next OHE to form a segment
                  if (i < data.length - 1) {
                      const nextRow = data[i+1];
                      const nextLat = cleanCoord(nextRow[latCol]);
                      const nextLon = cleanCoord(nextRow[lonCol]);
                      
                      if (!isNaN(nextLat) && !isNaN(nextLon)) {
                          snappedMeters = getProjectedChainage(
                              (bestP as GPSPoint).lat, (bestP as GPSPoint).lon, (bestP as GPSPoint).heading,
                              lat, lon, oheMeters,
                              nextLat, nextLon
                          );
                      }
                  }
                  
                  // If snapping failed (end of line or bad heading), fall back to OHE's own meter value
                  // But ONLY if heading is roughly consistent (optional strictness)
                  if (snappedMeters === null) {
                      snappedMeters = oheMeters; 
                  }

                  calculatedChainage = snappedMeters;

                  // C. Apply Limits using Linear Reference
                  limitApplied = getApplicableLimitLinear(snappedMeters, globalMPS, cautionOrders, trainLength);

                  if (speed! > limitApplied + 3) { status = 'violation'; }
                  else if (speed! > limitApplied) { status = 'warning'; }
              }
          }

          out.push({
              location: locName,
              latitude: lat,
              longitude: lon,
              logging_time: bestP ? (bestP as GPSPoint).timeStr : "",
              speed_kmph: speed,
              limit_applied: limitApplied,
              status,
              matched,
              source: type,
              chainage: calculatedChainage
          });
      }
      return out;
  };

  const finalResults = processDataset(masterDataRaw, isOheMaster ? 'OHE' : 'Signal', masterLatCol, masterLonCol, masterLabelCol);
  
  // --- 5. Signal History for Backtracking ---
  let signalResults: AnalysisResult[] = [];
  let signalHistory: AnalysisResult[] = [];
  
  if (isOheMaster && signalsDataRaw.length > 0) {
     const sLat = findColumn(signalsDataRaw, ["Latitude", "latitude", "lat"]);
     const sLon = findColumn(signalsDataRaw, ["Longitude", "longitude", "lon"]);
     const sLbl = findColumn(signalsDataRaw, ["Signal", "Name", "Label", "Station"]);
     if (sLat && sLon) {
         signalResults = processDataset(signalsDataRaw, 'Signal', sLat, sLon, sLbl || "Signal");
         signalHistory = signalResults
            .filter(s => s.matched && s.logging_time)
            .sort((a, b) => new Date(a.logging_time).getTime() - new Date(b.logging_time).getTime());
     }
  }

  // --- 6. Valid Section Logic ---
  const validSectionData = (firstMatchedRtisIndex !== Infinity && lastMatchedRtisIndex !== -1)
      ? rtisCleaned.filter(p => p.idx >= firstMatchedRtisIndex && p.idx <= lastMatchedRtisIndex)
      : [];

  // --- 7. Brake Tests (BFT/BPT) - Preserved Logic ---
  const brakeTests: BrakeTestResult[] = [];
  if (validSectionData.length > 0) {
      const startLoc = validSectionData[0];
      const entrySpeed = startLoc.speed;

      // Helper to find name for brake test location
      const findLocName = (lat: number, lon: number) => {
         // Simple nearest neighbor from results
         let minD = Infinity; let name = "Unknown";
         finalResults.forEach(r => {
             const d = getDistance(lat, lon, r.latitude, r.longitude);
             if(d < minD && d < 1000) { minD = d; name = r.location; }
         });
         return name;
      };

      if (entrySpeed > 15) {
          const detail = `Entered section at ${entrySpeed} km/h (Already Running)`;
          brakeTests.push({ type: 'BFT', status: 'not_performed', startSpeed: entrySpeed, lowestSpeed: entrySpeed, dropAmount: 0, location: findLocName(startLoc.lat, startLoc.lon), timestamp: startLoc.timeStr, details: detail });
          brakeTests.push({ type: 'BPT', status: 'not_performed', startSpeed: entrySpeed, lowestSpeed: entrySpeed, dropAmount: 0, location: findLocName(startLoc.lat, startLoc.lon), timestamp: startLoc.timeStr, details: detail });
      } else {
          // BFT
          let bftResult: BrakeTestResult | null = null;
          for (let i = 0; i < validSectionData.length - 1; i++) {
              const p = validSectionData[i];
              if (p.speed > 15) {
                  bftResult = { type: 'BFT', status: 'improper', startSpeed: p.speed, lowestSpeed: p.speed, dropAmount: 0, location: findLocName(p.lat, p.lon), timestamp: p.timeStr, details: "Speed crossed 15kmph without valid test" };
                  break; 
              }
              if (p.speed >= 10 && p.speed <= 15) {
                  let minSpeed = p.speed;
                  for(let j = i; j < Math.min(i + 20, validSectionData.length); j++) {
                      if (validSectionData[j].speed < minSpeed) minSpeed = validSectionData[j].speed;
                      if (validSectionData[j].speed === 0) minSpeed = 0; 
                  }
                  if (p.speed - minSpeed >= 5) {
                      bftResult = { type: 'BFT', status: 'proper', startSpeed: p.speed, lowestSpeed: minSpeed, dropAmount: p.speed - minSpeed, location: findLocName(p.lat, p.lon), timestamp: p.timeStr, details: "Drop >= 5 kmph observed" };
                      break;
                  }
              }
          }
          if(bftResult) brakeTests.push(bftResult);

          // BPT
          let bptResult: BrakeTestResult | null = null;
          for (let i = 0; i < validSectionData.length - 1; i++) {
              const p = validSectionData[i];
              if (getDistance(startLoc.lat, startLoc.lon, p.lat, p.lon) > 15000) break;

              if (p.speed >= 60) {
                  let minSpeed = p.speed;
                  for(let j = i; j < Math.min(i + 60, validSectionData.length); j++) {
                      if (validSectionData[j].speed < minSpeed) minSpeed = validSectionData[j].speed;
                  }
                  if (minSpeed <= (p.speed * 0.5)) {
                      bptResult = { type: 'BPT', status: 'proper', startSpeed: p.speed, lowestSpeed: minSpeed, dropAmount: p.speed - minSpeed, location: findLocName(p.lat, p.lon), timestamp: p.timeStr, details: "50% Drop observed" };
                      break; 
                  }
              }
          }
          if (!bptResult) {
              const opp = validSectionData.find(p => p.speed >= 60);
              if (opp && getDistance(startLoc.lat, startLoc.lon, opp.lat, opp.lon) <= 15000) {
                  brakeTests.push({ type: 'BPT', status: 'improper', startSpeed: opp.speed, lowestSpeed: opp.speed, dropAmount: 0, location: findLocName(opp.lat, opp.lon), timestamp: opp.timeStr, details: "Reached 60+ kmph but no 50% drop detected" });
              }
          } else {
              brakeTests.push(bptResult);
          }
      }
  }

  // --- 8. Stoppages & Halt Violations (Preserved Logic) ---
  const stoppages: Stoppage[] = [];
  let stopStart: GPSPoint | null = null;
  
  // Helper for finding nearest signal for stoppages
  const isNearSignal = (lat: number, lon: number) => {
      let found = false; let name = ""; let minD = Infinity;
      signalResults.forEach(s => {
          const d = getDistance(lat, lon, s.latitude, s.longitude);
          if(d < 200 && d < minD) { found = true; name = s.location; minD = d; }
      });
      return { found, name };
  };

  const stoppageSource = validSectionData;

  for (let i = 0; i < stoppageSource.length; i++) {
      const p = stoppageSource[i];
      if (p.speed === 0) {
          if (!stopStart) stopStart = p;
      } else {
          if (stopStart) {
              const durationMs = p.time.getTime() - stopStart.time.getTime();
              if (durationMs > 30000) { 
                  const sigCheck = isNearSignal(stopStart.lat, stopStart.lon);
                  stoppages.push({
                      location: sigCheck.found ? sigCheck.name : `Lat:${stopStart.lat.toFixed(4)}`,
                      latitude: stopStart.lat,
                      longitude: stopStart.lon,
                      arrivalTime: stopStart.timeStr,
                      departureTime: p.timeStr,
                      durationMin: Math.round(durationMs / 60000),
                      isSignal: sigCheck.found
                  });
              }
              stopStart = null;
          }
      }
  }

  const haltViolations: HaltApproachViolation[] = [];
  const LIMIT_100M = 15; 
  const LIMIT_PREV1 = 60; 
  const LIMIT_PREV2 = 100; 

  stoppages.forEach(stop => {
      if (!stop.isSignal) return;
      const stopIdx = stoppageSource.findIndex(p => p.timeStr === stop.arrivalTime);
      if (stopIdx === -1) return;

      for (let i = stopIdx - 1; i >= 0; i--) {
          const p = stoppageSource[i];
          const dist = getDistance(stop.latitude, stop.longitude, p.lat, p.lon);
          if (dist > 100) break; 
          if (p.speed > LIMIT_100M) {
              haltViolations.push({ haltLocation: stop.location, checkpoint: '100m Approach', limit: LIMIT_100M, actualSpeed: p.speed, timestamp: p.timeStr });
              break; 
          }
      }

      const sigHistoryIdx = signalHistory.findIndex(s => s.location === stop.location && new Date(s.logging_time).getTime() <= new Date(stop.arrivalTime).getTime());
      
      if (sigHistoryIdx !== -1) {
          if (sigHistoryIdx > 0) {
              const prev1 = signalHistory[sigHistoryIdx - 1];
              if ((prev1.speed_kmph || 0) > LIMIT_PREV1) {
                  haltViolations.push({ haltLocation: stop.location, checkpoint: `Prev Signal (${prev1.location})`, limit: LIMIT_PREV1, actualSpeed: Math.round(prev1.speed_kmph || 0), timestamp: prev1.logging_time });
              }
          }
          if (sigHistoryIdx > 1) {
              const prev2 = signalHistory[sigHistoryIdx - 2];
              if ((prev2.speed_kmph || 0) > LIMIT_PREV2) {
                  haltViolations.push({ haltLocation: stop.location, checkpoint: `2nd Prev Signal (${prev2.location})`, limit: LIMIT_PREV2, actualSpeed: Math.round(prev2.speed_kmph || 0), timestamp: prev2.logging_time });
              }
          }
      }
  });

  // --- 9. Summary ---
  const allSpeeds = validSectionData.map(p => p.speed);
  const avgSpeed = allSpeeds.length > 0 ? allSpeeds.reduce((a, b) => a + b, 0) / allSpeeds.length : 0;
  const matchedLen = finalResults.filter(r => r.matched).length;
  const violationCount = finalResults.filter(r => r.status === 'violation').length;
  const warningCount = finalResults.filter(r => r.status === 'warning').length;

  const summary: AnalysisSummary = {
    total_structures: finalResults.length,
    matched_structures: matchedLen,
    unmatched_structures: finalResults.length - matchedLen,
    match_rate: finalResults.length > 0 ? (matchedLen / finalResults.length) * 100 : 0,
    avg_speed: avgSpeed,
    max_speed: allSpeeds.length > 0 ? Math.max(...allSpeeds) : 0,
    min_speed: allSpeeds.length > 0 ? Math.min(...allSpeeds) : 0,
    violation_count: violationCount,
    warning_count: warningCount,
    config_mps: globalMPS,
    train_type: trainType,
    stoppages,
    brake_tests: brakeTests,
    halt_approach_violations: haltViolations
  };

  return { summary, results: finalResults, signals: signalResults };
}
