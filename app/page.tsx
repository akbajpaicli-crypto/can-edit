"use client"

import type React from "react"
import { useState } from "react"
import { Upload, MapPin, AlertTriangle, Trash2, Plus, TrainFront, Truck, Play, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AnalysisResults } from "@/components/analysis-results"

// --- TYPES ---
export type TrainType = 'passenger' | 'goods';

export interface CautionOrder {
  startOhe: string;
  endOhe: string;
  speedLimit: number;
}

// --- 1. ROBUST CSV PARSER ---
const parseCSV = async (file: File) => {
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = lines[0].toLowerCase().split(",").map(h => h.trim());
  
  const findCol = (candidates: string[]) => headers.findIndex(h => candidates.some(c => h.includes(c)));

  const latIdx = findCol(['lat', 'latitude', 'gps_lat']);
  const lngIdx = findCol(['lng', 'lon', 'longitude', 'gps_long']);
  const speedIdx = findCol(['speed', 'kmph', 'velocity', 'sp']);
  const timeIdx = findCol(['time', 'date', 'timestamp', 'packet_date']);
  const locIdx = findCol(['loc', 'station', 'mast', 'ohe', 'kilometer']);

  return lines.slice(1).map((line, i) => {
    const cols = line.split(",");
    if (cols.length < 2) return null;

    const lat = latIdx !== -1 ? parseFloat(cols[latIdx]) : NaN;
    const lng = lngIdx !== -1 ? parseFloat(cols[lngIdx]) : NaN;

    if (isNaN(lat) || isNaN(lng)) return null;

    // Robust Date Parsing
    let safeIsoTime = new Date().toISOString(); 
    if (timeIdx !== -1 && cols[timeIdx]) {
        const rawTime = cols[timeIdx].trim();
        let dateObj: Date | null = null;

        if (rawTime.includes("/")) {
            const parts = rawTime.split(/[/\s:]/);
            if (parts.length >= 3) {
                // Assume DD-MM-YYYY
                const day = parts[0]; const month = parts[1]; const year = parts[2];
                const hour = parts[3] || '00'; const min = parts[4] || '00'; const sec = parts[5] || '00';
                const d = new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}`);
                if (!isNaN(d.getTime())) dateObj = d;
            }
        } 
        if (!dateObj && rawTime.includes(":") && !rawTime.includes("-") && !rawTime.includes("/")) {
             const today = new Date().toISOString().split('T')[0];
             const d = new Date(`${today}T${rawTime}`);
             if (!isNaN(d.getTime())) dateObj = d;
        }
        if (!dateObj) {
            const d = new Date(rawTime);
            if (!isNaN(d.getTime())) dateObj = d;
        }
        if (dateObj) safeIsoTime = dateObj.toISOString();
    }

    return {
      id: i,
      location: locIdx !== -1 ? cols[locIdx] : `GPS-${i}`,
      latitude: lat,
      longitude: lng,
      speed_kmph: speedIdx !== -1 ? parseFloat(cols[speedIdx]) || 0 : 0,
      logging_time: safeIsoTime,
      matched: false,
      source: 'GPS',
      distanceToMast: Infinity // Temp field for sorting
    };
  }).filter(Boolean);
};

// --- 2. DISTANCE UTILS ---
const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371e3; 
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export default function Home() {
  const [rtisFile, setRtisFile] = useState<File | null>(null)
  const [oheFile, setOheFile] = useState<File | null>(null)
  const [signalsFile, setSignalsFile] = useState<File | null>(null)
  
  const [departureTime, setDepartureTime] = useState<string>("")
  const [arrivalTime, setArrivalTime] = useState<string>("")
  const [maxDistance, setMaxDistance] = useState<number>(50)
  const [globalMPS, setGlobalMPS] = useState<number>(110)
  const [trainType, setTrainType] = useState<TrainType>('passenger')
  
  const [cautionOrders, setCautionOrders] = useState<CautionOrder[]>([])
  const [newCO, setNewCO] = useState<CautionOrder>({ startOhe: "", endOhe: "", speedLimit: 0 })

  const [isProcessing, setIsProcessing] = useState(false)
  const [status, setStatus] = useState<{ type: "idle" | "processing" | "success" | "error"; message: string }>({
    type: "idle", message: "Ready for Analysis",
  })
  const [results, setResults] = useState<any>(null)

  const handleFileUpload = (setter: (f: File | null) => void, label: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
        setter(file);
        setStatus({ type: "idle", message: `${label} uploaded: ${file.name}` });
    }
  }

  const handleAddCO = () => {
    if (newCO.startOhe && newCO.endOhe && newCO.speedLimit > 0) {
      setCautionOrders([...cautionOrders, newCO]);
      setNewCO({ startOhe: "", endOhe: "", speedLimit: 0 });
    }
  }

  const handleRemoveCO = (index: number) => setCautionOrders(cautionOrders.filter((_, i) => i !== index));

  // --- LOGIC: HALTS & BRAKE TESTS (Run on Full Raw Data) ---
  const analyzeHaltsAndBrakeTests = (data: any[]) => {
      const stoppages = [];
      const brakeTests = [];
      let stopStart: any = null;
      let speedDropStart: any = null;

      const sorted = [...data].sort((a,b) => new Date(a.logging_time).getTime() - new Date(b.logging_time).getTime());

      for (let i = 0; i < sorted.length; i++) {
          const point = sorted[i];
          const speed = point.speed_kmph;

          // 1. Halt Detection (< 2kmph)
          if (speed < 2) {
              if (!stopStart) stopStart = point;
          } else {
              if (stopStart) {
                  const startTime = new Date(stopStart.logging_time);
                  const endTime = new Date(point.logging_time);
                  const durationMin = (endTime.getTime() - startTime.getTime()) / 60000;
                  
                  // UPDATED LOGIC: > 15 seconds (0.25 minutes)
                  if (durationMin > 0.25) { 
                      stoppages.push({
                          location: stopStart.location || `GPS Near ${stopStart.latitude.toFixed(4)}`,
                          arrivalTime: stopStart.logging_time,
                          departureTime: point.logging_time,
                          // Use toFixed(1) to show decimal minutes for short stops (e.g. 0.5 min)
                          durationMin: Number(durationMin.toFixed(1))
                      });
                      
                      // BPT Check: If stopped for > 0.25 min, likely a stop/start event
                      brakeTests.push({
                          type: 'BPT',
                          status: 'proper', 
                          testSpeed: 0,
                          finalSpeed: 0,
                          location: stopStart.location || `Near ${stopStart.latitude.toFixed(4)}`,
                          timestamp: stopStart.logging_time
                      });
                  }
                  stopStart = null;
              }
          }

          // 2. BFT Detection
          if (i > 0) {
              const prev = sorted[i-1];
              if (prev.speed_kmph > 20 && speed < prev.speed_kmph) {
                  if (!speedDropStart) speedDropStart = prev;
              } 
              else if (speed > prev.speed_kmph && speedDropStart) {
                   const drop = speedDropStart.speed_kmph - prev.speed_kmph;
                   if (drop > 8 && prev.speed_kmph > 10) {
                       brakeTests.push({
                           type: 'BFT',
                           status: 'proper',
                           testSpeed: Math.round(speedDropStart.speed_kmph),
                           finalSpeed: Math.round(prev.speed_kmph),
                           location: speedDropStart.location || "Running Line",
                           timestamp: speedDropStart.logging_time
                       });
                   }
                   speedDropStart = null;
              }
          }
      }
      return { stoppages, brakeTests };
  }

  const runIntegratedAnalysis = async () => {
    if (!rtisFile) {
        setStatus({ type: "error", message: "RTIS (GPS) file is missing." });
        return;
    }

    setIsProcessing(true);
    setResults(null);
    setStatus({ type: "processing", message: "Parsing files..." });

    try {
        const gpsData: any[] = await parseCSV(rtisFile);
        const oheData: any[] = oheFile ? await parseCSV(oheFile) : [];
        const signalData: any[] = signalsFile ? await parseCSV(signalsFile) : [];

        if (gpsData.length === 0) throw new Error("RTIS CSV is empty.");
        
        // --- 1. Filter by Time ---
        let filteredGps = gpsData;
        if (departureTime && arrivalTime) {
            const start = new Date(departureTime).getTime();
            const end = new Date(arrivalTime).getTime();
            
            if (end <= start) {
                throw new Error("End Time must be after Start Time. Please correct the dates.");
            }

            filteredGps = gpsData.filter(p => {
                const t = new Date(p.logging_time).getTime();
                return t >= start && t <= end;
            });
            if (filteredGps.length === 0) throw new Error("Time filter removed all points. Check your dates.");
        }

        // --- 2. Calculate Halts & Brake Tests (BEFORE reduction) ---
        const { stoppages, brakeTests } = analyzeHaltsAndBrakeTests(filteredGps);

        // --- 3. Match Logic (Strict: One Point Per OHE) ---
        setStatus({ type: "processing", message: "Matching to OHE Masts..." });
        
        let finalDisplayData = [];

        if (oheData.length > 0) {
            const oheMatches = new Map<string, any>(); 

            filteredGps.forEach(gps => {
                let nearestOhe = null;
                let minD = Infinity;

                for (const ohe of oheData) {
                    const d = getDistance(gps.latitude, gps.longitude, ohe.latitude, ohe.longitude);
                    if (d < minD && d <= maxDistance) {
                        minD = d;
                        nearestOhe = ohe;
                    }
                }

                if (nearestOhe) {
                    const existingBest = oheMatches.get(nearestOhe.location);
                    if (!existingBest || minD < existingBest.distanceToMast) {
                        oheMatches.set(nearestOhe.location, { 
                            ...gps, 
                            location: nearestOhe.location, 
                            matched: true,
                            distanceToMast: minD 
                        });
                    }
                }
            });

            finalDisplayData = Array.from(oheMatches.values()).sort((a,b) => 
                new Date(a.logging_time).getTime() - new Date(b.logging_time).getTime()
            );

        } else {
            finalDisplayData = filteredGps.map(p => ({...p, distanceToMast: 0, matched: false})); 
        }

        // --- 4. NEW LOGIC: MPS+1..3=Warning, MPS+4=Violation ---
        finalDisplayData = finalDisplayData.map(point => {
            let limit = globalMPS;
            let status = 'ok';

            // Caution Orders Override
            for (const co of cautionOrders) {
                if (point.location === co.startOhe || point.location === co.endOhe) {
                    limit = co.speedLimit;
                }
            }

            const speed = point.speed_kmph;

            if (speed <= limit) {
                status = 'ok';
            } else if (speed < limit + 4) {
                status = 'warning';
            } else {
                status = 'violation';
            }

            return { ...point, limit_applied: limit, status, source: 'GPS' };
        });

        const mapSignals = signalData.map(s => ({ ...s, source: 'Signal', matched: true, status: 'ok' }));
        const violations = finalDisplayData.filter(r => r.status === 'violation').length;
        const warnings = finalDisplayData.filter(r => r.status === 'warning').length;

        setResults({
            results: finalDisplayData,
            signals: mapSignals,
            summary: {
                total_structures: oheData.length,
                matched_structures: finalDisplayData.length,
                match_rate: oheData.length > 0 ? (finalDisplayData.length / oheData.length) * 100 : 0,
                violation_count: violations,
                warning_count: warnings,
                config_mps: globalMPS,
                brake_tests: brakeTests,
                stoppages: stoppages,
                halt_approach_violations: []
            }
        });

        setStatus({ type: "success", message: `Analysis Complete. Matched ${finalDisplayData.length} unique OHE points.` });

    } catch (e: any) {
        console.error(e);
        setStatus({ type: "error", message: e.message || "Unknown error" });
    } finally {
        setIsProcessing(false);
    }
  };

  const canAnalyze = !!rtisFile;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-white shadow-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3 flex items-center gap-4">
            <div className="flex-shrink-0">
               <img src="/railway-logo.jpeg" alt="IR" className="h-14 w-auto object-contain" onError={(e) => (e.target as HTMLImageElement).style.display = 'none'} />
            </div>
            <div>
                <h1 className="text-2xl font-bold text-foreground">Railway Geo-Analytics Platform</h1>
                <p className="text-xs text-muted-foreground font-medium uppercase">West Central Railway • Jabalpur Division</p>
            </div>
        </div>
      </header>

      <div className="container mx-auto p-4 flex-grow">
        <div className="grid gap-6 lg:grid-cols-[400px_1fr]">
          <div className="space-y-6">
            <Card className="p-6 shadow-md">
              <div className="space-y-6">
                <div className="space-y-4 border-b pb-4">
                  <h3 className="font-semibold text-sm flex items-center gap-2"><Upload className="h-4 w-4"/> Data Sources</h3>
                  <div className="space-y-3">
                    <div className="space-y-1"><Label className="text-xs font-medium">RTIS Data (GPS) *</Label><Input type="file" accept=".csv" onChange={handleFileUpload(setRtisFile, "RTIS")} className="cursor-pointer bg-muted/50"/></div>
                    <div className="space-y-1"><Label className="text-xs font-medium">OHE Data (Master)</Label><Input type="file" accept=".csv" onChange={handleFileUpload(setOheFile, "OHE")} className="cursor-pointer bg-muted/50"/></div>
                    <div className="space-y-1"><Label className="text-xs font-medium">Signal Data (Optional)</Label><Input type="file" accept=".csv" onChange={handleFileUpload(setSignalsFile, "Signal")} className="cursor-pointer bg-muted/50"/></div>
                  </div>
                </div>

                <div className="space-y-4 border-b pb-4">
                  <h3 className="font-semibold text-sm">Configuration</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1"><Label className="text-xs">Departure Time</Label><Input type="datetime-local" step="60" value={departureTime} onChange={(e) => setDepartureTime(e.target.value)} className="text-xs"/></div>
                    <div className="space-y-1"><Label className="text-xs">Arrival Time</Label><Input type="datetime-local" step="60" value={arrivalTime} onChange={(e) => setArrivalTime(e.target.value)} className="text-xs"/></div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Train Type</Label>
                    <div className="grid grid-cols-2 gap-2">
                        <div onClick={() => setTrainType('passenger')} className={`cursor-pointer border rounded-md p-2 flex items-center justify-center gap-2 text-xs transition-colors ${trainType === 'passenger' ? 'bg-primary/10 border-primary text-primary font-bold' : 'hover:bg-muted'}`}><TrainFront className="h-4 w-4" /> Passenger</div>
                        <div onClick={() => setTrainType('goods')} className={`cursor-pointer border rounded-md p-2 flex items-center justify-center gap-2 text-xs transition-colors ${trainType === 'goods' ? 'bg-primary/10 border-primary text-primary font-bold' : 'hover:bg-muted'}`}><Truck className="h-4 w-4" /> Goods</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1"><Label className="text-xs">MPS (km/h)</Label><Input type="number" value={globalMPS} onChange={(e) => setGlobalMPS(Number(e.target.value))} /></div>
                      <div className="space-y-1"><Label className="text-xs">Match Dist (m)</Label><Input type="number" value={maxDistance} onChange={(e) => setMaxDistance(Number(e.target.value))} /></div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between"><h3 className="font-semibold text-sm">Caution Orders</h3><span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{cautionOrders.length} Active</span></div>
                  <div className="grid grid-cols-[1fr_1fr_0.7fr] gap-2">
                    <Input placeholder="Start" className="text-xs" value={newCO.startOhe} onChange={(e) => setNewCO({...newCO, startOhe: e.target.value})} />
                    <Input placeholder="End" className="text-xs" value={newCO.endOhe} onChange={(e) => setNewCO({...newCO, endOhe: e.target.value})} />
                    <Input placeholder="Kmph" type="number" className="text-xs" value={newCO.speedLimit || ''} onChange={(e) => setNewCO({...newCO, speedLimit: Number(e.target.value)})} />
                  </div>
                  <Button variant="secondary" size="sm" onClick={handleAddCO} className="w-full h-8 text-xs"><Plus className="mr-2 h-3 w-3" /> Add Caution Order</Button>
                  {cautionOrders.length > 0 && (
                      <div className="max-h-32 overflow-y-auto space-y-2 border rounded p-2 bg-muted/20">
                          {cautionOrders.map((co, idx) => (
                              <div key={idx} className="flex items-center justify-between text-xs bg-background p-2 rounded border shadow-sm">
                                  <span className="font-mono">{co.startOhe} ➔ {co.endOhe}</span>
                                  <div className="flex items-center gap-2"><span className="font-bold text-orange-600 bg-orange-50 px-1.5 rounded">{co.speedLimit}</span><Trash2 className="h-3 w-3 cursor-pointer text-muted-foreground hover:text-destructive" onClick={() => handleRemoveCO(idx)} /></div>
                              </div>
                          ))}
                      </div>
                  )}
                </div>

                <div className="pt-2"><Button onClick={runIntegratedAnalysis} disabled={!canAnalyze || isProcessing} className="w-full font-bold shadow-sm" size="lg">{isProcessing ? <><RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Processing...</> : <><Play className="mr-2 h-4 w-4" /> Run Analysis</>}</Button></div>
                {status.type !== 'idle' && (<div className={`rounded-lg border p-3 text-xs font-medium flex items-center gap-2 ${status.type === "success" ? "border-green-200 bg-green-50 text-green-700" : status.type === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-blue-200 bg-blue-50 text-blue-700"}`}>{status.type === "error" ? <AlertTriangle className="h-4 w-4" /> : <div className="h-2 w-2 rounded-full bg-current animate-pulse"/>}{status.message}</div>)}
              </div>
            </Card>
          </div>

          <div className="min-h-[600px]">
            {results ? <AnalysisResults data={results} /> : (
              <Card className="flex h-full min-h-[600px] flex-col items-center justify-center p-12 bg-muted/10 border-dashed">
                <div className="text-center space-y-4">
                  <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-muted"><MapPin className="h-10 w-10 text-muted-foreground/50" /></div>
                  <div><h3 className="text-xl font-semibold text-foreground">Awaiting Data</h3><p className="text-sm text-muted-foreground max-w-sm mx-auto mt-2">Upload your RTIS (GPS) logs and Section Master (OHE/Signal) files to generate a comprehensive speed analysis report.</p></div>
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
