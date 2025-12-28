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
  chainage?: number; 
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
  heading: number;
}

// ==========================================
// 2. Math & Geometry Helpers
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

function getDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS * c;
}

function getBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
            Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  const brng = Math.atan2(y, x);
  return (toDeg(brng) + 360) % 360;
}

function oheToMeters(oheStr: string): number {
  if (!oheStr) return 0;
  const clean = oheStr.replace(/[^\d\/]/g, '');
  if (clean.includes('/')) {
    const [km, pole] = clean.split('/').map(Number);
    return (km * 1000) + (pole * 60);
  }
  const val = Number(clean);
  return isNaN(val) ? 0 : val * 1000;
}

function getProjectedChainage(
  trainLat: number, trainLon: number, trainHeading: number,
  segStartLat: number, segStartLon: number, segStartMeters: number,
  segEndLat: number, segEndLon: number
): number | null {
  const segBearing = getBearing(segStartLat, segStartLon, segEndLat, segEndLon);
  let diff = Math.abs(segBearing - trainHeading);
  if (diff > 180) diff = 360 - diff;
  if (diff > 45) return null; 

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
  if (t < -0.1 || t > 1.1) return null;

  const segLen = getDistance(segStartLat, segStartLon, segEndLat, segEndLon);
  return segStartMeters + (t * segLen);
}

// ==========================================
// 3. New Logic: Spatial Caution Order "Walk"
// ==========================================

function preprocessCautionOrders(
  orders: CautionOrder[],
  masterData: Array<Record<string, string>>,
  labelCol: string,
  latCol: string,
  lonCol: string,
  trainLength: number
): { startM: number; endM: number; limit: number }[] {
  
  return orders.map(co => {
    // 1. Find physical indices in Master Data
    const startIdx = masterData.findIndex(row => (row[labelCol] || "").trim() === co.startOhe.trim());
    const endIdx = masterData.findIndex(row => (row[labelCol] || "").trim() === co.endOhe.trim());

    // Fallback if OHE not found in file
    if (startIdx === -1 || endIdx === -1) {
      const s = oheToMeters(co.startOhe);
      const e = oheToMeters(co.endOhe);
      return { 
        startM: Math.min(s, e), 
        endM: Math.max(s, e) + trainLength, 
        limit: co.speedLimit 
      };
    }

    // 2. Determine Direction (Are we moving down or up the list?)
    // Direction = 1 means we move to higher indices; -1 means lower indices
    const direction = endIdx > startIdx ? 1 : -1;
    
    // 3. "Walk" the train length starting from the End point
    let currentIdx = endIdx;
    let distanceCovered = 0;

    // Safety limit to prevent infinite loops (max 100 masts check ~ 6km)
    let steps = 0;
    while (distanceCovered < trainLength && steps < 100) {
      const nextIdx = currentIdx + direction;

      // Stop if we hit the file boundary
      if (nextIdx < 0 || nextIdx >= masterData.length) break;

      const p1 = masterData[currentIdx];
      const p2 = masterData[nextIdx];

      const lat1 = cleanCoord(p1[latCol]);
      const lon1 = cleanCoord(p1[lonCol]);
      const lat2 = cleanCoord(p2[latCol]);
      const lon2 = cleanCoord(p2[lonCol]);

      if (!isNaN(lat1) && !isNaN(lon1) && !isNaN(lat2) && !isNaN(lon2)) {
        const d = getDistance(lat1, lon1, lat2, lon2);
        // Sanity check: if distance between masts > 200m, likely data gap, stop here
        if (d < 200) distanceCovered += d;
      }
      
      currentIdx = nextIdx;
      steps++;
    }

    // 4. Determine Effective Range
    const startM = oheToMeters(masterData[startIdx][labelCol]);
    const endM = oheToMeters(masterData[endIdx][labelCol]);
    const extendedEndM = oheToMeters(masterData[currentIdx][labelCol]);

    // Create a min/max range for fast checking later
    // The valid range is everything between Start and the Extended End point
    return {
      startM: Math.min(startM, extendedEndM),
      endM: Math.max(startM, extendedEndM),
      limit: co.speedLimit
    };
  });
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
  const result = Papa.parse(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim()
  });
  return result.data as Array<Record<string, string>>;
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
// 5. CORE ANALYZER
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

  let tempRtis: GPSPoint[] = rtisDataRaw
    .map((row, idx) => {
      let lat = cleanCoord(row[rtisLatCol]);
      let lon = cleanCoord(row[rtisLonCol]);
      if (lat > 60 && lon < 40) { [lat, lon] = [lon, lat]; } 
      
      const speedRaw = parseFloat(row[rtisSpeedCol]);
      const timeStr = row[rtisTimeCol];
      const timeDate = timeStr ? new Date(timeStr) : new Date(0);
      
      return {
        idx, lat, lon,
        speed: !isNaN(speedRaw) ? Math.round(speedRaw) : 0,
        time: timeDate,
        timeStr,
        heading: 0
      };
    })
    .filter(p => !isNaN(p.lat) && !isNaN(p.lon) && p.lat !== 0 && p.lon !== 0)
    .filter(p => p.time.getTime() >= depTimeMs && p.time.getTime() <= arrTimeMs)
    .sort((a, b) => a.time.getTime() - b.time.getTime());

  for(let i = 0; i < tempRtis.length - 1; i++) {
    const dist = getDistance(tempRtis[i].lat, tempRtis[i].lon, tempRtis[i+1].lat, tempRtis[i+1].lon);
    if(dist > 5) {
        tempRtis[i].heading = getBearing(tempRtis[i].lat, tempRtis[i].lon, tempRtis[i+1].lat, tempRtis[i+1].lon);
    } else if (i > 0) {
        tempRtis[i].heading = tempRtis[i-1].heading;
    }
  }
  if(tempRtis.length > 0) tempRtis[tempRtis.length-1].heading = tempRtis[tempRtis.length-2]?.heading || 0;

  const rtisCleaned = tempRtis;
  const trainLength = trainType === 'goods' ? 700 : 600; 

  // --- 3. Process OHE (Master Data) ---
  const isOheMaster = oheDataRaw.length > 0;
  let masterDataRaw = isOheMaster ? oheDataRaw : signalsDataRaw;
  
  const masterLatCol = findColumn(masterDataRaw, ["Latitude", "latitude", "lat", "gps_lat", "y"]);
  const masterLonCol = findColumn(masterDataRaw, ["Longitude", "longitude", "lon", "long", "gps_long", "x"]);
  const masterLabelCol = findColumn(masterDataRaw, ["OHEMas", "OHE", "pole", "Signal", "Name", "Station", "Label", "Asset"]) || "Location";

  if (!masterLatCol || !masterLonCol) throw new Error("Master file missing Latitude/Longitude columns");

  // --- NEW: Preprocess Caution Orders (Spatial Walk) ---
  // We only do this if we have OHE master data available
  let processedCOs: { startM: number; endM: number; limit: number }[] = [];
  if (isOheMaster) {
    processedCOs = preprocessCautionOrders(cautionOrders, masterDataRaw, masterLabelCol, masterLatCol, masterLonCol, trainLength);
  }

  // Create Grid for Fast Lookup
  const rtisMatchGrid = new GridIndex(0.01);
  rtisCleaned.forEach(p => rtisMatchGrid.insert(p.idx, p.lat, p.lon));

  // --- 4. Matching Logic & Violation Detection ---
  
  let firstMatchedRtisIndex = Infinity; 
  let lastMatchedRtisIndex = -1;

  const processDataset = (data: any[], type: 'OHE' | 'Signal', latCol: string, lonCol: string, labelCol: string) => {
      const out: AnalysisResult[] = [];
      const threshold = (maxDistance && maxDistance > 0) ? maxDistance : 500;
      
      for (let i = 0; i < data.length; i++) {
          const row = data[i];
          let lat = cleanCoord(row[latCol]);
          let lon = cleanCoord(row[lonCol]);
          const locName = row[labelCol] || "Unknown";
          
          if (isNaN(lat) || isNaN(lon)) continue;
          if (lat > 60 && lon < 40) { [lat, lon] = [lon, lat]; }

          const candidates = rtisMatchGrid.query(lat, lon);
          let bestP: GPSPoint | null = null;
          let bestDist = Infinity;
          
          candidates.forEach(c => {
              const rtisPt = rtisCleaned[c.idx];
              const dist = getDistance(lat, lon, rtisPt.lat, rtisPt.lon);
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
                  let snappedMeters: number | null = null;
                  
                  // Projection / Snapping
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
                  if (snappedMeters === null) snappedMeters = oheMeters; 
                  calculatedChainage = snappedMeters;

                  // --- Limit Check using Preprocessed Spatial Data ---
                  limitApplied = globalMPS;
                  for (const co of processedCOs) {
                    if (calculatedChainage >= co.startM && calculatedChainage <= co.endM) {
                       if (co.limit < limitApplied!) limitApplied = co.limit;
                    }
                  }

                  if (speed! > limitApplied! + 3) { status = 'violation'; }
                  else if (speed! > limitApplied!) { status = 'warning'; }
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
  
  // --- 5. Signal History ---
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

  // --- 7. Brake Tests (BFT/BPT) ---
  const brakeTests: BrakeTestResult[] = [];
  if (validSectionData.length > 0) {
      const startLoc = validSectionData[0];
      const entrySpeed = startLoc.speed;
      const findLocName = (lat: number, lon: number) => {
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

  // --- 8. Stoppages & Halt Violations ---
  const stoppages: Stoppage[] = [];
  let stopStart: GPSPoint | null = null;
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
