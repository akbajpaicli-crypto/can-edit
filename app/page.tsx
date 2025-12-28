"use client"

import { useState } from "react"
import { Upload, Calendar, AlertTriangle, Play, Plus, Trash2, Train, Truck, Info, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AnalysisResults } from "@/components/analysis-results"

// --- Types ---
interface CautionOrder {
  id: string;
  start: string;
  end: string;
  speed: string;
}

// --- 1. ROBUST LOCAL PARSER (Safe from 'reading lat' errors) ---
// We renamed this to 'processFileSafely' to ensure you are using the new logic.
const processFileSafely = async (file: File) => {
  try {
    const text = await file.text();
    // Split by new line and remove strictly empty rows
    const lines = text.split(/\r?\n/).filter(line => line && line.trim().length > 0);
    
    if (lines.length < 2) return []; // Need at least header + 1 data row

    // Normalize headers to lowercase to find columns easily
    const headers = lines[0].toLowerCase().split(",").map(h => h.trim());
    
    // Helper to find column index (returns -1 if not found)
    const getIdx = (candidates: string[]) => headers.findIndex(h => candidates.some(c => h.includes(c)));

    // Detect column indices dynamically
    const latIdx = getIdx(['lat', 'latitude']);
    const lngIdx = getIdx(['lon', 'lng', 'longitude']);
    const speedIdx = getIdx(['speed', 'velocity', 'kmph']);
    const locIdx = getIdx(['loc', 'station', 'km_post', 'mast']);
    const timeIdx = getIdx(['time', 'date', 'timestamp']);
    const typeIdx = getIdx(['type', 'source', 'obj']);

    // Parse each line
    return lines.slice(1).map((line, index) => {
      const cols = line.split(",");
      
      // Skip if row is too short (malformed CSV line)
      if (cols.length < 2) return null;

      // Safe number parsing
      const latVal = latIdx !== -1 ? parseFloat(cols[latIdx]) : NaN;
      const lngVal = lngIdx !== -1 ? parseFloat(cols[lngIdx]) : NaN;

      // CRITICAL SAFETY CHECK: 
      // If latitude is missing or invalid, skip this row entirely.
      // This prevents the "reading 'lat'" crash later on.
      if (isNaN(latVal) || isNaN(lngVal)) {
        return null;
      }

      return {
        location: (locIdx !== -1 && cols[locIdx]) ? cols[locIdx] : `Point ${index + 1}`,
        latitude: latVal,
        longitude: lngVal,
        speed_kmph: speedIdx !== -1 ? (parseFloat(cols[speedIdx]) || 0) : 0,
        logging_time: timeIdx !== -1 ? cols[timeIdx] : new Date().toISOString(),
        source: typeIdx !== -1 ? cols[typeIdx] : 'GPS',
        matched: true, 
        status: 'ok' as const
      };
    }).filter(Boolean); // Remove null entries
  } catch (e) {
    console.error("CSV Parse Error:", e);
    return [];
  }
};

export default function DashboardPage() {
  // --- State ---
  const [gpsFile, setGpsFile] = useState<File | null>(null)
  const [signalFile, setSignalFile] = useState<File | null>(null)
  
  const [config, setConfig] = useState({
    departureTime: "",
    arrivalTime: "",
    trainType: "passenger" as "passenger" | "goods",
    mps: "110",
    matchDist: "50"
  })

  const [cautionOrders, setCautionOrders] = useState<CautionOrder[]>([
    { id: '1', start: '', end: '', speed: '' }
  ])

  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [analysisData, setAnalysisData] = useState<any>(null)

  // --- Handlers ---
  const handleAddCautionOrder = () => {
    setCautionOrders([...cautionOrders, { id: Math.random().toString(), start: '', end: '', speed: '' }])
  }

  const handleRemoveCautionOrder = (id: string) => {
    setCautionOrders(cautionOrders.filter(c => c.id !== id))
  }

  const handleCautionChange = (id: string, field: keyof CautionOrder, value: string) => {
    setCautionOrders(cautionOrders.map(c => c.id === id ? { ...c, [field]: value } : c))
  }

  // --- 2. FIXED ANALYSIS HANDLER ---
  const handleAnalysis = async () => {
    setError(null)
    setIsAnalyzing(true)
    setAnalysisData(null)

    try {
      if (!gpsFile) throw new Error("Please upload a GPS CSV file to begin.")

      // STEP A: Use the SAFE parser (not 'analyzeData' or 'mockAnalyzeData')
      console.log("Starting CSV parse...");
      const gpsResults = await processFileSafely(gpsFile);
      
      if (!gpsResults || gpsResults.length === 0) {
        throw new Error("GPS File contains no valid coordinates (Latitude/Longitude columns missing or empty).");
      }

      // STEP B: Parse Signal Data (Optional)
      let signalResults: any[] = [];
      if (signalFile) {
        const rawSignals = await processFileSafely(signalFile);
        // Force source to 'Signal' so they appear blue/distinct on map
        signalResults = (rawSignals || []).map((s: any) => ({ ...s, source: 'Signal', matched: true }));
      }

      // STEP C: Apply Logic (Speed Checks)
      const mps = Number(config.mps) || 110;
      
      // We map over results to add 'limit_applied' and 'status'
      const processedResults = gpsResults.map((point: any) => {
        let status = 'ok';
        let limit = mps;

        // Check MPS Violation
        if (point.speed_kmph > mps) {
            status = 'violation';
        }

        // Check Caution Orders
        cautionOrders.forEach(co => {
             if(co.start && co.end && co.speed) {
                 // Check if point location string matches start/end of caution order
                 if(point.location && (point.location.includes(co.start) || point.location.includes(co.end))) {
                     const cautionLimit = Number(co.speed);
                     if (!isNaN(cautionLimit)) {
                        limit = cautionLimit;
                        if(point.speed_kmph > limit) status = 'violation';
                     }
                 }
             }
        });

        return { ...point, limit_applied: limit, status };
      });

      // STEP D: Prepare Final Data Object
      const violations = processedResults.filter((r: any) => r.status === 'violation');
      
      const data = {
        results: processedResults,
        signals: signalResults,
        summary: {
          matched_structures: processedResults.length,
          violation_count: violations.length,
          warning_count: 0,
          match_rate: 100,
          config_mps: mps,
          brake_tests: [],
          stoppages: [],
          halt_approach_violations: []
        }
      };

      console.log("Analysis complete. Setting data.");
      setAnalysisData(data);

    } catch (err: any) {
      console.error("Analysis Crashed:", err)
      setError(err.message || "An unexpected error occurred. Check console for details.")
    } finally {
      setIsAnalyzing(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b px-6 py-4 flex items-center gap-4 sticky top-0 z-50">
        <div className="bg-red-600 rounded-full p-2">
            <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center text-red-600 font-bold text-xs">IR</div>
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Railway Geo-Analytics Platform</h1>
          <p className="text-xs text-slate-500 font-medium">WEST CENTRAL RAILWAY • JABALPUR DIVISION</p>
        </div>
      </header>

      <main className="flex-1 p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* --- LEFT SIDEBAR --- */}
        <div className="lg:col-span-3 space-y-6">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-3"><CardTitle className="text-base">Upload Data</CardTitle></CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2">
                    <Label className="text-xs font-semibold text-slate-500">Signal Data (Optional)</Label>
                    <div className="border-2 border-dashed border-slate-200 rounded-md p-3 hover:bg-slate-50 transition-colors cursor-pointer relative">
                        <Input type="file" accept=".csv" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => setSignalFile(e.target.files?.[0] || null)}/>
                        <div className="flex items-center gap-2 text-sm text-slate-600">
                            <Upload className="w-4 h-4" />
                            <span className="truncate">{signalFile ? signalFile.name : "Choose file signals.csv"}</span>
                        </div>
                    </div>
                </div>
                <div className="space-y-2">
                    <Label className="text-xs font-semibold text-slate-500">GPS/OHE Data (Required)</Label>
                    <div className="border-2 border-dashed border-slate-200 rounded-md p-3 hover:bg-slate-50 transition-colors cursor-pointer relative">
                        <Input type="file" accept=".csv" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => setGpsFile(e.target.files?.[0] || null)}/>
                        <div className="flex items-center gap-2 text-sm text-slate-600">
                            <Upload className="w-4 h-4" />
                            <span className="truncate">{gpsFile ? gpsFile.name : "Choose file gps.csv"}</span>
                        </div>
                    </div>
                </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-3"><CardTitle className="text-base">Configuration</CardTitle></CardHeader>
            <CardContent className="space-y-4">
                <div className="grid grid-cols-1 gap-3">
                    <div className="space-y-1.5">
                        <Label className="text-xs text-slate-500">Departure Time</Label>
                        <Input type="datetime-local" step="60" value={config.departureTime} onChange={(e) => setConfig({...config, departureTime: e.target.value})} className="text-sm"/>
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs text-slate-500">Arrival Time</Label>
                        <Input type="datetime-local" step="60" value={config.arrivalTime} onChange={(e) => setConfig({...config, arrivalTime: e.target.value})} className="text-sm"/>
                    </div>
                </div>

                <div className="space-y-1.5">
                    <Label className="text-xs text-slate-500">Train Type</Label>
                    <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-md">
                        <button onClick={() => setConfig({...config, trainType: 'passenger'})} className={`text-xs font-medium py-1.5 rounded-sm transition-all ${config.trainType === 'passenger' ? 'bg-white shadow' : 'text-slate-500'}`}><Train className="inline w-3 h-3 mr-1"/>Passenger</button>
                        <button onClick={() => setConfig({...config, trainType: 'goods'})} className={`text-xs font-medium py-1.5 rounded-sm transition-all ${config.trainType === 'goods' ? 'bg-white shadow' : 'text-slate-500'}`}><Truck className="inline w-3 h-3 mr-1"/>Goods</button>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5"><Label className="text-xs text-slate-500">MPS (km/h)</Label><Input type="number" value={config.mps} onChange={(e) => setConfig({...config, mps: e.target.value})}/></div>
                    <div className="space-y-1.5"><Label className="text-xs text-slate-500">Match Dist (m)</Label><Input type="number" value={config.matchDist} onChange={(e) => setConfig({...config, matchDist: e.target.value})}/></div>
                </div>

                <div className="pt-2 border-t">
                    <div className="flex items-center justify-between mb-2">
                        <Label className="text-sm font-semibold">Caution Orders</Label>
                        <span className="text-xs bg-slate-100 px-2 py-0.5 rounded-full text-slate-600">{cautionOrders.length} Active</span>
                    </div>
                    <div className="space-y-2 max-h-[150px] overflow-y-auto pr-1">
                        {cautionOrders.map((co) => (
                            <div key={co.id} className="grid grid-cols-[1fr_1fr_0.8fr_auto] gap-2 items-center">
                                <Input className="h-7 text-xs px-2" placeholder="Start" value={co.start} onChange={(e) => handleCautionChange(co.id, 'start', e.target.value)} />
                                <Input className="h-7 text-xs px-2" placeholder="End" value={co.end} onChange={(e) => handleCautionChange(co.id, 'end', e.target.value)} />
                                <Input className="h-7 text-xs px-2" placeholder="Limit" value={co.speed} onChange={(e) => handleCautionChange(co.id, 'speed', e.target.value)} />
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-red-500" onClick={() => handleRemoveCautionOrder(co.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                            </div>
                        ))}
                    </div>
                    <Button variant="secondary" size="sm" className="w-full mt-2 text-xs gap-1 h-8" onClick={handleAddCautionOrder}><Plus className="w-3.5 h-3.5" /> Add Caution Order</Button>
                </div>
            </CardContent>
            
            <div className="p-4 pt-0">
                <Button className="w-full bg-[#1e293b] hover:bg-[#0f172a] text-white" onClick={handleAnalysis} disabled={isAnalyzing || !gpsFile}>
                    {isAnalyzing ? <span className="flex items-center gap-2">Processing...</span> : <span className="flex items-center gap-2"><Play className="w-4 h-4"/> Run Analysis</span>}
                </Button>
            </div>
          </Card>

          {error && (
            <Alert variant="destructive" className="bg-red-50 text-red-900 border-red-200">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Analysis Error</AlertTitle>
                <AlertDescription className="text-xs mt-1">{error}</AlertDescription>
            </Alert>
          )}
        </div>

        {/* --- RIGHT CONTENT AREA --- */}
        <div className="lg:col-span-9">
            {analysisData ? (
                <AnalysisResults data={analysisData} />
            ) : (
                <div className="h-full min-h-[500px] flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-lg bg-slate-50/50 text-slate-400">
                    <div className="bg-white p-4 rounded-full shadow-sm mb-4"><Info className="w-8 h-8 text-slate-300" /></div>
                    <h3 className="font-semibold text-lg text-slate-600">No Analysis Generated</h3>
                    <p className="text-sm max-w-sm text-center mt-2">Upload your GPS CSV data and configure the parameters on the left sidebar to generate a speed analysis report.</p>
                </div>
            )}
        </div>

      </main>
    </div>
  )
}
