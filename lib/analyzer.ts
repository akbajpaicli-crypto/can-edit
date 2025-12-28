import Papa from 'papaparse';

// --- 1. EXPORTED TYPES (Source of Truth) ---
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

// --- 2. HELPERS ---
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

// --- 3. CORE ANALYZER FUNCTION ---
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
  
  // A. Parse Inputs
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

  const isOheMaster = oheDataRaw.length > 0;
  let masterDataRaw = isOheMaster ? oheDataRaw : signalsDataRaw;
  const masterLatCol = findColumn(masterDataRaw, ["Latitude", "latitude", "lat", "gps_lat", "y"]);
  const masterLonCol = findColumn(masterDataRaw, ["Longitude", "longitude", "lon", "long", "gps_long", "x"]);
  const masterLabelCol = findColumn(masterDataRaw, ["OHEMas", "OHE", "pole", "Signal", "Name", "Station", "Label", "Asset"]) || "Location";

  if (!masterLatCol || !masterLonCol) throw new Error("Master file missing Latitude/Longitude columns");

  // B. Master Grid
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
          if (dist < 100 && dist < bestDist) { 
              bestDist = dist;
              bestName = signal.name;
          }
      });
      return { found: bestDist < 100, name: bestName };
  };

  // C. Prepare RTIS
  const depTimeMs = departureTime ? new Date(departureTime).getTime() : 0;
  const arrTimeMs = arrivalTime ? new Date(arrivalTime).getTime() : Infinity;

  const rtisCleaned = rtisDataRaw
    .map((row, idx) => {
      let lat = cleanCoord(row[rtisLatCol]);
      let lon = cleanCoord(row[rtisLonCol]);
      const speedRaw = parseFloat(row[rtisSpeedCol]);
      const timeStr = row[rtisTimeCol];
      if (lat > 60 && lon < 40) { [lat, lon] = [lon, lat]; }
      const roundedSpeed = !isNaN(speedRaw) ? Math.round(speedRaw) : 0;
      const timeDate = timeStr ? new Date(timeStr) : new Date(0);
      return { idx, lat, lon, speed: roundedSpeed, time: timeDate, timeStr, valid: !isNaN(lat) && !isNaN(lon) && lat !== 0 && lon !== 0 };
    })
    .filter(p => p.valid)
    .filter(p => p.time.getTime() >= depTimeMs && p.time.getTime() <= arrTimeMs)
    .sort((a, b) => a.time.getTime() - b.time.getTime());

  // D. Matching
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
                  limitApplied = getApplicableLimit(locName, lat, lon, globalMPS, cautionOrders, oheLocationMap, trainLength);
                  if (speed! > limitApplied + 3) { status = 'violation'; }
                  else if (speed! > limitApplied) { status = 'warning'; }
              }
          }
          out.push({ location: locName, latitude: lat, longitude: lon, logging_time: bestP ? (bestP as any).timeStr : "", speed_kmph: speed, limit_applied: limitApplied, status, matched, source: type });
      });
      return out;
  };

  const finalResults = processDataset(masterDataRaw, isOheMaster ? 'OHE' : 'Signal', masterLatCol, masterLonCol, masterLabelCol);
  
  let signalResults: AnalysisResult[] = [];
  let signalHistory: AnalysisResult[] = [];
  if (isOheMaster && signalsDataRaw.length > 0) {
     const sLat = findColumn(signalsDataRaw, ["Latitude", "latitude", "lat"]);
     const sLon = findColumn(signalsDataRaw, ["Longitude", "longitude", "lon"]);
     const sLbl = findColumn(signalsDataRaw, ["Signal", "Name", "Label", "Station"]);
     if (sLat && sLon) {
         signalResults = processDataset(signalsDataRaw, 'Signal', sLat, sLon, sLbl || "Signal");
         signalHistory = signalResults.filter(s => s.matched && s.logging_time).sort((a, b) => new Date(a.logging_time).getTime() - new Date(b.logging_time).getTime());
     }
  }

  // E. Valid Section & Logic
  const validSectionData = (firstMatchedRtisIndex !== Infinity && lastMatchedRtisIndex !== -1)
      ? rtisCleaned.filter(p => p.idx >= firstMatchedRtisIndex && p.idx <= lastMatchedRtisIndex)
      : [];

  const brakeTests: BrakeTestResult[] = [];
  if (validSectionData.length > 0) {
      const startLoc = validSectionData[0];
      const entrySpeed = startLoc.speed;

      if (entrySpeed > 15) {
          const detail = `Entered section at ${entrySpeed} km/h (Already Running)`;
          brakeTests.push({ type: 'BFT', status: 'not_performed', startSpeed: entrySpeed, lowestSpeed: entrySpeed, dropAmount: 0, location: findNearestLocation(startLoc.lat, startLoc.lon), timestamp: startLoc.timeStr, details: detail });
          brakeTests.push({ type: 'BPT', status: 'not_performed', startSpeed: entrySpeed, lowestSpeed: entrySpeed, dropAmount: 0, location: findNearestLocation(startLoc.lat, startLoc.lon), timestamp: startLoc.timeStr, details: detail });
      } else {
          // BFT
          let bftResult: BrakeTestResult | null = null;
          for (let i = 0; i < validSectionData.length - 1; i++) {
              const p = validSectionData[i];
              if (p.speed > 15) {
                  bftResult = { type: 'BFT', status: 'improper', startSpeed: p.speed, lowestSpeed: p.speed, dropAmount: 0, location: findNearestLocation(p.lat, p.lon), timestamp: p.timeStr, details: "Crossed 15kmph without test" };
                  break; 
              }
              if (p.speed >= 10 && p.speed <= 15) {
                  let minSpeed = p.speed;
                  for(let j = i; j < Math.min(i + 30, validSectionData.length); j++) {
                      if (validSectionData[j].speed < minSpeed) minSpeed = validSectionData[j].speed;
                  }
                  if (minSpeed <= 11) {
                      bftResult = { type: 'BFT', status: 'proper', startSpeed: p.speed, lowestSpeed: minSpeed, dropAmount: p.speed - minSpeed, location: findNearestLocation(p.lat, p.lon), timestamp: p.timeStr, details: "Dropped to ~10 kmph" };
                      break; 
                  }
              }
          }
          if(bftResult) brakeTests.push(bftResult);
          else brakeTests.push({ type: 'BFT', status: 'not_performed', startSpeed: 0, lowestSpeed: 0, dropAmount: 0, location: "-", timestamp: "-", details: "No valid test window" });

          // BPT
          const minStart = trainType === 'passenger' ? 60 : 40;
          const maxStart = trainType === 'passenger' ? 70 : 50;
          const reqDropMin = trainType === 'passenger' ? 30 : 20;
          let bptResult: BrakeTestResult | null = null;

          for (let i = 0; i < validSectionData.length - 1; i++) {
              const p = validSectionData[i];
              if (haversineMeters(startLoc.lat, startLoc.lon, p.lat, p.lon) > 15000) break;
              if (p.speed >= minStart && p.speed <= maxStart) {
                  let minSpeed = p.speed;
                  for(let j = i; j < Math.min(i + 60, validSectionData.length); j++) {
                      if (validSectionData[j].speed < minSpeed) minSpeed = validSectionData[j].speed;
                  }
                  const drop = p.speed - minSpeed;
                  if (drop >= reqDropMin) {
                      bptResult = { type: 'BPT', status: 'proper', startSpeed: p.speed, lowestSpeed: minSpeed, dropAmount: drop, location: findNearestLocation(p.lat, p.lon), timestamp: p.timeStr, details: `Drop of ${drop} kmph` };
                      break; 
                  }
              }
          }
          if (!bptResult) {
              const opp = validSectionData.find(p => p.speed >= minStart);
              if (opp && haversineMeters(startLoc.lat, startLoc.lon, opp.lat, opp.lon) <= 15000) {
                  brakeTests.push({ type: 'BPT', status: 'improper', startSpeed: opp.speed, lowestSpeed: opp.speed, dropAmount: 0, location: findNearestLocation(opp.lat, opp.lon), timestamp: opp.timeStr, details: `Reached ${minStart}+ but no drop` });
              } else {
                  brakeTests.push({ type: 'BPT', status: 'not_performed', startSpeed: 0, lowestSpeed: 0, dropAmount: 0, location: "-", timestamp: "-", details: `Did not reach ${minStart} kmph` });
              }
          } else {
              brakeTests.push(bptResult);
          }
      }
  }

  // Stoppages & Violations
  const stoppages: Stoppage[] = [];
  let stopStart: (typeof rtisCleaned[0]) | null = null;
  const stoppageSource = validSectionData.length > 0 ? validSectionData : [];
  for (let i = 0; i < stoppageSource.length; i++) {
      const p = stoppageSource[i];
      if (p.speed === 0) { if (!stopStart) stopStart = p; } 
      else {
          if (stopStart) {
              const durationMs = p.time.getTime() - stopStart.time.getTime();
              if (durationMs > 30000) { 
                  const sigCheck = isNearSignal(stopStart.lat, stopStart.lon);
                  stoppages.push({ location: sigCheck.found ? sigCheck.name : findNearestLocation(stopStart.lat, stopStart.lon), latitude: stopStart.lat, longitude: stopStart.lon, arrivalTime: stopStart.timeStr, departureTime: p.timeStr, durationMin: Math.round(durationMs / 60000), isSignal: sigCheck.found });
              }
              stopStart = null;
          }
      }
  }

  const haltViolations: HaltApproachViolation[] = [];
  stoppages.forEach(stop => {
      if (!stop.isSignal) return;
      const stopIdx = stoppageSource.findIndex(p => p.timeStr === stop.arrivalTime);
      if (stopIdx === -1) return;
      // 1. 100m check
      for (let i = stopIdx - 1; i >= 0; i--) {
          const p = stoppageSource[i];
          const dist = haversineMeters(stop.latitude, stop.longitude, p.lat, p.lon);
          if (dist > 100) break; 
          if (p.speed > 15) { haltViolations.push({ haltLocation: stop.location, checkpoint: '100m Approach', limit: 15, actualSpeed: p.speed, timestamp: p.timeStr }); break; }
      }
      // 2. Previous Signals
      const sigHistoryIdx = signalHistory.findIndex(s => s.location === stop.location && new Date(s.logging_time).getTime() <= new Date(stop.arrivalTime).getTime());
      if (sigHistoryIdx !== -1) {
          if (sigHistoryIdx > 0) {
              const prev1 = signalHistory[sigHistoryIdx - 1];
              if ((prev1.speed_kmph || 0) > 60) haltViolations.push({ haltLocation: stop.location, checkpoint: `Prev Signal (${prev1.location})`, limit: 60, actualSpeed: Math.round(prev1.speed_kmph || 0), timestamp: prev1.logging_time });
          }
          if (sigHistoryIdx > 1) {
              const prev2 = signalHistory[sigHistoryIdx - 2];
              if ((prev2.speed_kmph || 0) > 100) haltViolations.push({ haltLocation: stop.location, checkpoint: `2nd Prev Signal (${prev2.location})`, limit: 100, actualSpeed: Math.round(prev2.speed_kmph || 0), timestamp: prev2.logging_time });
          }
      }
  });

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
