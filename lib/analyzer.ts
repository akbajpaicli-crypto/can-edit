import Papa from 'papaparse';

// --- Types ---
export interface CautionOrder {
  startOhe: string;
  endOhe: string;
  speedLimit: number;
}

export type TrainType = 'passenger' | 'goods';

export interface BrakeTestResult {
  type: 'BFT' | 'BPT';
  status: 'proper' | 'improper' | 'not_performed';
  testSpeed: number;
  finalSpeed: number;
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
  isSignal: boolean; // New Flag
}

export interface HaltApproachViolation {
  haltLocation: string;
  distanceMarker: '100m' | '1000m' | '2000m';
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

// --- Helpers ---

function cleanCoord(val: any): number {
  if (typeof val === 'number') return val;
  if (!val) return NaN;
  const clean = val.toString().replace(/["'°NESW\s]/g, ''); 
  return parseFloat(clean);
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000.0;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dphi = ((lat2 - lat1) * Math.PI) / 180;
  const dlambda = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlambda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function parseOHE(oheStr: string) {
  if (!oheStr) return { km: 0, pole: 0 };
  const clean = oheStr.replace(/[^\d\/]/g, '');
  if (clean.includes('/')) {
    const [km, pole] = clean.split('/').map(Number);
    return { km, pole };
  }
  return { km: Number(clean) || 0, pole: 0 };
}

function compareOHE(strA: string, strB: string) {
  const a = parseOHE(strA);
  const b = parseOHE(strB);
  if (a.km !== b.km) return a.km - b.km;
  return a.pole - b.pole;
}

function getApplicableLimit(
  location: string, 
  lat: number,
  lon: number,
  globalMPS: number, 
  cautionOrders: CautionOrder[],
  oheMap: Map<string, {lat: number, lon: number}>,
  trainLength: number
): number {
  let limit = globalMPS;

  for (const co of cautionOrders) {
    const startVal = compareOHE(co.startOhe, co.endOhe);
    const lower = startVal <= 0 ? co.startOhe : co.endOhe;
    const upper = startVal <= 0 ? co.endOhe : co.startOhe;

    const isInside = compareOHE(location, lower) >= 0 && compareOHE(location, upper) <= 0;

    if (isInside) {
      limit = Math.min(limit, co.speedLimit);
      continue; 
    }

    const lowerCoords = oheMap.get(lower);
    if (lowerCoords && haversineMeters(lat, lon, lowerCoords.lat, lowerCoords.lon) <= trainLength) {
        limit = Math.min(limit, co.speedLimit);
        continue;
    }

    const upperCoords = oheMap.get(upper);
    if (upperCoords && haversineMeters(lat, lon, upperCoords.lat, upperCoords.lon) <= trainLength) {
        limit = Math.min(limit, co.speedLimit);
        continue;
    }
  }
  return limit;
}

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

// --- CORE ANALYZER ---

export async function analyzeData(
  rtisFile: File,
  oheFile: File | null, 
  signalsFile: File | null, 
  maxDistance: number,
  globalMPS: number,
  cautionOrders: CautionOrder[],
  trainType: TrainType
): Promise<{ summary: AnalysisSummary; results: AnalysisResult[]; signals: AnalysisResult[] }> {
  
  // 1. Parse Inputs
  const rtisContent = await rtisFile.text();
  const rtisDataRaw = parseCSV(rtisContent);
  const oheContent = oheFile ? await oheFile.text() : "";
  const oheDataRaw = oheContent ? parseCSV(oheContent) : [];
  const signalsContent = signalsFile ? await signalsFile.text() : "";
  const signalsDataRaw = signalsContent ? parseCSV(signalsContent) : [];

  const rtisLatCol = findColumn(rtisDataRaw, ["Latitude", "lat", "gps_lat"]);
  const rtisLonCol = findColumn(rtisDataRaw, ["Longitude", "lon", "long", "gps_long"]);
  const rtisTime = findColumn(rtisDataRaw, ["Logging Time", "LoggingTime", "timestamp", "date", "time"]);
  const rtisSpeed = findColumn(rtisDataRaw, ["Speed", "speed", "speed_kmph", "velocity"]);

  if (!rtisLatCol || !rtisLonCol || !rtisTime || !rtisSpeed) throw new Error("RTIS file missing critical columns");

  // 2. Identify Columns
  const isOheMaster = oheDataRaw.length > 0;
  let masterDataRaw = isOheMaster ? oheDataRaw : signalsDataRaw;
  
  const masterLatCol = findColumn(masterDataRaw, ["Latitude", "latitude", "lat", "gps_lat", "y"]);
  const masterLonCol = findColumn(masterDataRaw, ["Longitude", "longitude", "lon", "long", "gps_long", "x"]);
  const masterLabelCol = findColumn(masterDataRaw, ["OHEMas", "OHE", "pole", "Signal", "Name", "Station", "Label", "Asset"]) || "Location";

  if (!masterLatCol || !masterLonCol) throw new Error("Master file missing Latitude/Longitude columns");

  // --- STEP 3: MASTER GRID ---
  const masterGrid = new GridIndex(0.01);
  const oheLocationMap = new Map<string, {lat: number, lon: number}>(); 

  masterDataRaw.forEach((row, idx) => {
      let lat = cleanCoord(row[masterLatCol]);
      let lon = cleanCoord(row[masterLonCol]);
      if (lat > 60 && lon < 40) { [lat, lon] = [lon, lat]; }
      if (!isNaN(lat) && !isNaN(lon) && lat !== 0 && lon !== 0) {
          masterGrid.insert(idx, lat, lon);
          const label = row[masterLabelCol];
          if(label) oheLocationMap.set(label, {lat, lon});
      }
  });

  // --- STEP 3b: SIGNAL GRID (For Stoppage Logic) ---
  const signalGrid = new GridIndex(0.01);
  let signalDataList: Array<{lat: number, lon: number, name: string}> = [];
  
  if (signalsDataRaw.length > 0) {
      const sLat = findColumn(signalsDataRaw, ["Latitude", "latitude", "lat"]);
      const sLon = findColumn(signalsDataRaw, ["Longitude", "longitude", "lon"]);
      const sLbl = findColumn(signalsDataRaw, ["Signal", "Name", "Label", "Station"]) || "Signal";
      
      if(sLat && sLon) {
          signalsDataRaw.forEach((row, idx) => {
              let lat = cleanCoord(row[sLat]);
              let lon = cleanCoord(row[sLon]);
              if (lat > 60 && lon < 40) { [lat, lon] = [lon, lat]; }
              if (!isNaN(lat) && !isNaN(lon)) {
                  signalGrid.insert(idx, lat, lon);
                  signalDataList.push({lat, lon, name: row[sLbl] || "Signal"});
              }
          });
      }
  }

  const findNearestLocation = (lat: number, lon: number): string => {
      const candidates = masterGrid.query(lat, lon);
      let bestName = `Lat:${lat.toFixed(4)}, Lon:${lon.toFixed(4)}`;
      let bestDist = Infinity;
      candidates.forEach(c => {
          const dist = haversineMeters(lat, lon, c.lat, c.lon);
          if (dist < bestDist && dist < 500) { 
              bestDist = dist;
              bestName = masterDataRaw[c.idx][masterLabelCol] || bestName;
          }
      });
      return bestName;
  };

  const isNearSignal = (lat: number, lon: number): {found: boolean, name: string} => {
      const candidates = signalGrid.query(lat, lon);
      let bestDist = Infinity;
      let bestName = "";
      candidates.forEach(c => {
          const signal = signalDataList[c.idx];
          const dist = haversineMeters(lat, lon, signal.lat, signal.lon);
          if (dist < 100 && dist < bestDist) { // Strict 100m check for Halt
              bestDist = dist;
              bestName = signal.name;
          }
      });
      return { found: bestDist < 100, name: bestName };
  };

  // --- STEP 4: PREPARE RTIS ---
  const rtisCleaned = rtisDataRaw
    .map((row, idx) => {
      let lat = cleanCoord(row[rtisLatCol]);
      let lon = cleanCoord(row[rtisLonCol]);
      const speedRaw = parseFloat(row[rtisSpeed]);
      const timeStr = row[rtisTime];
      if (lat > 60 && lon < 40) { [lat, lon] = [lon, lat]; }
      const roundedSpeed = !isNaN(speedRaw) ? Math.round(speedRaw) : 0;

      return {
        idx,
        lat,
        lon,
        speed: roundedSpeed, 
        time: timeStr ? new Date(timeStr) : new Date(0),
        timeStr,
        valid: !isNaN(lat) && !isNaN(lon) && lat !== 0 && lon !== 0
      };
    })
    .filter(p => p.valid)
    .sort((a, b) => a.time.getTime() - b.time.getTime());

  // --- STEP 5: MATCHING & CAUTION LOGIC ---
  const rtisMatchGrid = new GridIndex(0.01);
  rtisCleaned.forEach(p => rtisMatchGrid.insert(p.idx, p.lat, p.lon));

  let firstMatchedRtisIndex = Infinity; 
  let lastMatchedRtisIndex = -1;
  const trainLength = trainType === 'goods' ? 700 : 600; 

  const processDataset = (data: any[], type: 'OHE' | 'Signal', latCol: string, lonCol: string, labelCol: string) => {
      const out: AnalysisResult[] = [];
      data.forEach(row => {
          let lat = cleanCoord(row[latCol]);
          let lon = cleanCoord(row[lonCol]);
          const locName = row[labelCol] || "Unknown";
          
          if (isNaN(lat) || isNaN(lon)) return;
          if (lat > 60 && lon < 40) { [lat, lon] = [lon, lat]; }

          const candidates = rtisMatchGrid.query(lat, lon);
          let bestP = null;
          let bestDist = Infinity;
          
          candidates.forEach(c => {
              const dist = haversineMeters(lat, lon, c.lat, c.lon);
              if (dist < bestDist) { bestDist = dist; bestP = rtisCleaned[c.idx]; }
          });

          let speed: number | null = null;
          let limitApplied: number | null = null;
          let status: 'ok' | 'warning' | 'violation' = 'ok';
          let matched = false;

          const threshold = (maxDistance && maxDistance > 0) ? maxDistance : 500;

          if (bestP && bestDist <= threshold) {
              matched = true;
              speed = (bestP as any).speed;
              
              const pIdx = (bestP as any).idx;
              if (pIdx < firstMatchedRtisIndex) firstMatchedRtisIndex = pIdx;
              if (pIdx > lastMatchedRtisIndex) lastMatchedRtisIndex = pIdx;

              if (type === 'OHE') {
                  limitApplied = getApplicableLimit(
                      locName, lat, lon, 
                      globalMPS, cautionOrders, 
                      oheLocationMap, trainLength
                  );

                  if (speed! > limitApplied + 3) { status = 'violation'; }
                  else if (speed! > limitApplied) { status = 'warning'; }
              }
          }

          out.push({
              location: locName,
              latitude: lat,
              longitude: lon,
              logging_time: bestP ? (bestP as any).timeStr : "",
              speed_kmph: speed,
              limit_applied: limitApplied,
              status,
              matched,
              source: type
          });
      });
      return out;
  };

  const finalResults = processDataset(masterDataRaw, isOheMaster ? 'OHE' : 'Signal', masterLatCol, masterLonCol, masterLabelCol);
  
  let signalResults: AnalysisResult[] = [];
  if (isOheMaster && signalsDataRaw.length > 0) {
     const sLat = findColumn(signalsDataRaw, ["Latitude", "latitude", "lat"]);
     const sLon = findColumn(signalsDataRaw, ["Longitude", "longitude", "lon"]);
     const sLbl = findColumn(signalsDataRaw, ["Signal", "Name", "Label", "Station"]);
     if (sLat && sLon) {
         signalResults = processDataset(signalsDataRaw, 'Signal', sLat, sLon, sLbl || "Signal");
     }
  }

  // --- STEP 6: CREATE VALID SECTION DATA ---
  const validSectionData = (firstMatchedRtisIndex !== Infinity && lastMatchedRtisIndex !== -1)
      ? rtisCleaned.filter(p => p.idx >= firstMatchedRtisIndex && p.idx <= lastMatchedRtisIndex)
      : [];

  // --- STEP 7: BRAKE TESTS (ON VALID SECTION) ---
  const brakeTests: BrakeTestResult[] = [];
  
  if (validSectionData.length > 0) {
      const startLoc = validSectionData[0];
      const BFT_TARGET_MIN = 10, BFT_TARGET_MAX = 15, BFT_FAIL_THRESHOLD = 15, BFT_DROP_REQ = 5;
      const BPT_TARGET_MIN = 60, BPT_TARGET_MAX = 70;
      const entrySpeed = startLoc.speed;

      if (entrySpeed > BFT_FAIL_THRESHOLD) {
          brakeTests.push({ type: 'BFT', status: 'not_performed', testSpeed: entrySpeed, finalSpeed: entrySpeed, location: findNearestLocation(startLoc.lat, startLoc.lon), timestamp: startLoc.timeStr, details: `Running Train (>15 km/h)` });
          brakeTests.push({ type: 'BPT', status: 'not_performed', testSpeed: entrySpeed, finalSpeed: entrySpeed, location: findNearestLocation(startLoc.lat, startLoc.lon), timestamp: startLoc.timeStr, details: `Running Train (>15 km/h)` });
      } else {
          const checkSpeedDrop = (startIndex: number, dropAmount: number, isPercent: boolean): { passed: boolean, minSpeed: number } => {
              let startSpeed = validSectionData[startIndex].speed;
              let windowEnd = Math.min(startIndex + 180, validSectionData.length);
              let minSpeed = startSpeed;
              for (let j = startIndex; j < windowEnd; j++) {
                  const p = validSectionData[j];
                  if (p.speed < minSpeed) minSpeed = p.speed;
                  if (p.speed === 0) { minSpeed = 0; break; } 
              }
              let passed = false;
              if (isPercent) passed = minSpeed <= (startSpeed * (1 - dropAmount));
              else passed = (startSpeed - minSpeed) >= dropAmount;
              return { passed, minSpeed };
          };

          // BFT
          let bftDone = false;
          for (let i = 0; i < validSectionData.length - 1; i++) {
              const p = validSectionData[i];
              if (p.speed > BFT_FAIL_THRESHOLD) {
                  brakeTests.push({ type: 'BFT', status: 'improper', testSpeed: p.speed, finalSpeed: p.speed, location: findNearestLocation(p.lat, p.lon), timestamp: p.timeStr, details: "Crossed 15 km/h without test" });
                  bftDone = true; break;
              }
              if (p.speed >= BFT_TARGET_MIN && p.speed <= BFT_TARGET_MAX) {
                  const result = checkSpeedDrop(i, BFT_DROP_REQ, false); 
                  if (result.passed) {
                      brakeTests.push({ type: 'BFT', status: 'proper', testSpeed: p.speed, finalSpeed: result.minSpeed, location: findNearestLocation(p.lat, p.lon), timestamp: p.timeStr });
                      bftDone = true; break;
                  }
              }
          }

          // BPT
          let bptDone = false;
          for (let i = 0; i < validSectionData.length - 1; i++) {
              const p = validSectionData[i];
              const dist = haversineMeters(startLoc.lat, startLoc.lon, p.lat, p.lon);
              if (dist > 15000) break; 
              if (p.speed >= BPT_TARGET_MIN && p.speed <= BPT_TARGET_MAX) {
                  const result = checkSpeedDrop(i, 0.5, true); 
                  if (result.passed) {
                      brakeTests.push({ type: 'BPT', status: 'proper', testSpeed: p.speed, finalSpeed: result.minSpeed, location: findNearestLocation(p.lat, p.lon), timestamp: p.timeStr });
                      bptDone = true; break;
                  }
              }
          }
          if (!bptDone) {
             const opp = validSectionData.find(p => p.speed >= BPT_TARGET_MIN && p.speed <= BPT_TARGET_MAX);
             if(opp) {
                 brakeTests.push({ type: 'BPT', status: 'improper', testSpeed: opp.speed, finalSpeed: opp.speed, location: findNearestLocation(opp.lat, opp.lon), timestamp: opp.timeStr, details: "Skipped Test" });
             }
          }
      }
  }

  // --- STEP 8: STOPPAGES (ON VALID SECTION) ---
  const stoppages: Stoppage[] = [];
  let stopStart: (typeof rtisCleaned[0]) | null = null;
  const stoppageSource = validSectionData.length > 0 ? validSectionData : [];

  for (let i = 0; i < stoppageSource.length; i++) {
      const p = stoppageSource[i];
      if (p.speed === 0) {
          if (!stopStart) stopStart = p;
      } else {
          if (stopStart) {
              const durationMs = p.time.getTime() - stopStart.time.getTime();
              if (durationMs > 30000) { 
                  // Check if this stop is at a signal
                  const sigCheck = isNearSignal(stopStart.lat, stopStart.lon);
                  
                  stoppages.push({
                      location: sigCheck.found ? sigCheck.name : findNearestLocation(stopStart.lat, stopStart.lon),
                      latitude: stopStart.lat,
                      longitude: stopStart.lon,
                      arrivalTime: stopStart.timeStr,
                      departureTime: p.timeStr,
                      durationMin: Math.round(durationMs / 60000),
                      isSignal: sigCheck.found // Tag it
                  });
              }
              stopStart = null;
          }
      }
  }

  // --- STEP 9: HALT VIOLATIONS (Signal Checks) ---
  const haltViolations: HaltApproachViolation[] = [];
  const LIMITS = trainType === 'passenger' ? { d100: 10, d1000: 60, d2000: 100 } : { d100: 5, d1000: 40, d2000: 55 };

  stoppages.forEach(stop => {
      // Logic: Only check if it was a SIGNAL stop
      if (!stop.isSignal) return;

      const stopIdx = stoppageSource.findIndex(p => p.timeStr === stop.arrivalTime);
      if (stopIdx === -1) return;
      
      let f100=false, f1000=false, f2000=false;
      // Scan backwards from stop time
      for (let i = stopIdx - 1; i >= 0; i--) {
          const p = stoppageSource[i];
          const dist = haversineMeters(stop.latitude, stop.longitude, p.lat, p.lon);
          
          if (!f100 && dist >= 100 && dist < 200) { 
              if (p.speed > LIMITS.d100) haltViolations.push({ haltLocation: stop.location, distanceMarker: '100m', limit: LIMITS.d100, actualSpeed: p.speed, timestamp: p.timeStr }); 
              f100 = true; 
          }
          if (!f1000 && dist >= 1000 && dist < 1200) { 
              if (p.speed > LIMITS.d1000) haltViolations.push({ haltLocation: stop.location, distanceMarker: '1000m', limit: LIMITS.d1000, actualSpeed: p.speed, timestamp: p.timeStr }); 
              f1000 = true; 
          }
          if (!f2000 && dist >= 2000 && dist < 2300) { 
              if (p.speed > LIMITS.d2000) haltViolations.push({ haltLocation: stop.location, distanceMarker: '2000m', limit: LIMITS.d2000, actualSpeed: p.speed, timestamp: p.timeStr }); 
              f2000 = true; 
              break; // Optimization: stop looking after 2km
          }
          if (dist > 3000) break; 
      }
  });

  // --- STEP 10: SUMMARY ---
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
