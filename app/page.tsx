"use client"

import type React from "react"
import { useState } from "react"
import { Upload, MapPin, AlertTriangle, Trash2, Plus, TrainFront, Truck, Play, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AnalysisResults } from "@/components/analysis-results"

export type TrainType = 'passenger' | 'goods';

export interface CautionOrder {
  startOhe: string;
  endOhe: string;
  speedLimit: number;
}

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

    let safeIsoTime = new Date().toISOString(); 
    if (timeIdx !== -1 && cols[timeIdx]) {
        const rawTime = cols[timeIdx].trim();
        let dateObj: Date | null = null;
        if (rawTime.includes("/")) {
            const parts = rawTime.split(/[/\s:]/);
            if (parts.length >= 3) {
                const day = parts[0]; const month = parts[1]; const year = parts[2];
                const hour = parts[3] || '00'; const min = parts[4] || '00'; const sec = parts[5] || '00';
                const d = new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}`);
                if (!isNaN(d.getTime())) dateObj = d;
            }
        } else {
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
      distanceToMast: Infinity 
    };
  }).filter(Boolean);
};

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
  const [status, setStatus] = useState<{ type: "idle" | "processing" | "success" | "error"; message: string }>({ type: "idle", message: "Ready" })
  const [results, setResults] = useState<any>(null)

  const handleFileUpload = (setter: (f: File | null) => void, label: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { setter(file); setStatus({ type: "idle", message: `${label} uploaded` }); }
  }

  const handleAddCO = () => {
    if (newCO.startOhe && newCO.endOhe && newCO.speedLimit > 0) {
      setCautionOrders([...cautionOrders, newCO]); setNewCO({ startOhe: "", endOhe: "", speedLimit: 0 });
    }
  }

  const handleRemoveCO = (index: number) => setCautionOrders(cautionOrders.filter((_, i) => i !== index));

  const analyzeHaltsAndBrakeTests = (data: any[]) => {
      const stoppages = [];
      const brakeTests = [];
      let stopStart: any = null;
      let speedDropStart: any = null;

      const sorted = [...data].sort((a,b) => new Date(a.logging_time).getTime() - new Date(b.logging_time).getTime());

      for (let i = 0; i < sorted.length; i++) {
          const point = sorted[i];
          const speed = point.speed_kmph;

          // RELAXED STOPPAGE LOGIC: Speed < 5 kmph (account for GPS drift)
          if (speed < 5) {
              if (!stopStart) stopStart = point;
          } else {
              if (stopStart) {
                  const startTime = new Date(stopStart.logging_time);
                  const endTime = new Date(point.logging_time);
                  const durationMin = (endTime.getTime() - startTime.getTime()) / 60000;
                  
                  // Check if stop > 15 seconds (0.25 min)
                  if (durationMin > 0.25) { 
                      stoppages.push({
                          location: stopStart.location || `GPS Near ${stopStart.latitude.toFixed(4)}`,
                          arrivalTime: stopStart.logging_time,
                          departureTime: point.logging_time,
                          durationMin: Number(durationMin.toFixed(1))
                      });
                      
                      // Likely a BPT if stop was significant (>1 min)
                      if (durationMin > 1) {
                          brakeTests.push({
                              type: 'BPT',
                              status: 'proper', 
                              testSpeed: 0,
                              finalSpeed: 0,
                              location: stopStart.location || `Near ${stopStart.latitude.toFixed(4)}`,
                              timestamp: stopStart.logging_time
                          });
                      }
                  }
                  stopStart = null;
              }
          }

          // BFT Logic (Running)
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
                           location: speedDropStart.location,
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
    if (!rtisFile) { setStatus({ type: "error", message: "RTIS (GPS) missing." }); return; }
    setIsProcessing(true); setStatus({ type: "processing", message: "Parsing..." });

    try {
        const gpsData: any[] = await parseCSV(rtisFile);
        const oheData: any[] = oheFile ? await parseCSV(oheFile) : [];
        const signalData: any[] = signalsFile ? await parseCSV(signalsFile) : [];

        if (gpsData.length === 0) throw new Error("RTIS CSV empty.");
        
        let filteredGps = gpsData;
        if (departureTime && arrivalTime) {
            const start = new Date(departureTime).getTime();
            const end = new Date(arrivalTime).getTime();
            if (end <= start) throw new Error("End Time must be > Start Time.");
            filteredGps = gpsData.filter(p => {
                const t = new Date(p.logging_time).getTime();
                return t >= start && t <= end;
            });
            if (filteredGps.length === 0) throw new Error("Time filter removed all points.");
        }

        // Calculate Stops on RAW filtered data
        const { stoppages, brakeTests } = analyzeHaltsAndBrakeTests(filteredGps);

        // Filter One Point Per Mast for Map/Graph
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
            finalDisplayData = Array.from(oheMatches.values());
        } else {
            finalDisplayData = filteredGps;
        }

        // Sort by Time
        finalDisplayData.sort((a,b) => new Date(a.logging_time).getTime() - new Date(b.logging_time).getTime());

        // Limits Logic
        finalDisplayData = finalDisplayData.map(point => {
            let limit = globalMPS;
            let status = 'ok';
            for (const co of cautionOrders) {
                if (point.location === co.startOhe || point.location === co.endOhe) limit = co.speedLimit;
            }
            const speed = point.speed_kmph;
            if (speed <= limit) status = 'ok';
            else if (speed < limit + 4) status = 'warning';
            else status = 'violation';
            return { ...point, limit_applied: limit, status, source: 'GPS' };
        });

        // Format Signals
        const mapSignals = signalData.map(s => ({ ...s, source: 'Signal', matched: true, status: 'ok' }));

        setResults({
            results: finalDisplayData,
            signals: mapSignals,
            summary: {
                total_structures: oheData.length,
                matched_structures: finalDisplayData.length,
                match_rate: oheData.length > 0 ? (finalDisplayData.length / oheData.length) * 100 : 0,
                violation_count: finalDisplayData.filter(r => r.status === 'violation').length,
                warning_count: finalDisplayData.filter(r => r.status === 'warning').length,
                config_mps: globalMPS,
                brake_tests: brakeTests,
                stoppages: stoppages,
                halt_approach_violations: []
            }
        });
        setStatus({ type: "success", message: "Analysis Complete." });
    } catch (e: any) {
        console.error(e);
        setStatus({ type: "error", message: e.message || "Error" });
    } finally {
        setIsProcessing(false);
    }
  };

  const canAnalyze = !!rtisFile;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="container mx-auto p-4 flex-grow">
        <div className="grid gap-6 lg:grid-cols-[400px_1fr]">
          <div className="space-y-6">
            <Card className="p-6 shadow-md">
                <div className="space-y-4">
                  <h3 className="font-semibold text-sm">Data Sources</h3>
                  <Input key={rtisFile ? "gps-loaded" : "gps-empty"} type="file" accept=".csv" onChange={handleFileUpload(setRtisFile, "RTIS")} />
                  <Input key={oheFile ? "ohe-loaded" : "ohe-empty"} type="file" accept=".csv" onChange={handleFileUpload(setOheFile, "OHE")} />
                  <Input key={signalsFile ? "sig-loaded" : "sig-empty"} type="file" accept=".csv" onChange={handleFileUpload(setSignalsFile, "Signal")} />
                </div>
                {/* ... Config Section same as before ... */}
                <div className="pt-4"><Button onClick={runIntegratedAnalysis} disabled={!canAnalyze || isProcessing} className="w-full">{isProcessing ? "Processing..." : "Run Analysis"}</Button></div>
                {status.type !== 'idle' && <div className={`text-xs p-2 rounded ${status.type==='error'?'bg-red-100 text-red-700':'bg-green-100 text-green-700'}`}>{status.message}</div>}
            </Card>
          </div>
          <div className="min-h-[600px]">
            {results ? <AnalysisResults data={results} /> : <div className="text-center p-12 border-dashed border-2 text-muted-foreground">Awaiting Data</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
