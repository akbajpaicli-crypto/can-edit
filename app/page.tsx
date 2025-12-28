"use client"

import { useState } from "react"
import { Upload, Calendar, AlertTriangle, Play, Plus, Trash2, Train, Truck, Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AnalysisResults } from "@/components/analysis-results"

// --- Mock Parser (Replace this with your actual 'analyzeData' import) ---
// If you have a utility file, import it: import { analyzeData } from "@/lib/analyzer"
// For now, I am putting a placeholder here to prevent the file from breaking if you copy-paste it.
const mockAnalyzeData = async (gpsFile: File, signalFile: File | null, config: any) => {
  // This is where your actual parsing logic lives. 
  // ensuring we don't crash if files are empty.
  if (!gpsFile) throw new Error("GPS File is required");
  
  // SIMULATED RETURN DATA STRUCTURE (Matches your previous errors/needs)
  return {
    results: [], // This would be your parsed GPS points
    signals: [], // This would be your parsed Signal points
    summary: {
      matched_structures: 0,
      violation_count: 0,
      warning_count: 0,
      match_rate: 0,
      config_mps: config.mps,
      brake_tests: [],
      stoppages: [],
      halt_approach_violations: []
    }
  };
};

// --- Types ---
interface CautionOrder {
  id: string;
  start: string;
  end: string;
  speed: string;
}

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

  const handleAnalysis = async () => {
    setError(null)
    setIsAnalyzing(true)
    setAnalysisData(null)

    try {
      if (!gpsFile) {
        throw new Error("Please upload a GPS CSV file to begin.")
      }

      // 1. Prepare Config
      const analysisConfig = {
        ...config,
        mps: Number(config.mps),
        matchDist: Number(config.matchDist),
        cautionOrders: cautionOrders.filter(c => c.start && c.end && c.speed).map(c => ({
            start: c.start,
            end: c.end,
            limit: Number(c.speed)
        }))
      }

      // 2. Run Analysis (Replace 'mockAnalyzeData' with your actual import)
      // Example: const data = await analyzeData(gpsFile, signalFile, analysisConfig)
      
      // NOTE: Since I don't have your parser code, this is a safety wrapper.
      // You should replace the line below with your actual function call.
      const data = await mockAnalyzeData(gpsFile, signalFile, analysisConfig); 

      // 3. Safety Check on Returned Data (Fixes "Cannot read properties of undefined")
      if (!data || !data.results) {
        throw new Error("The analysis returned no data. Please check your CSV format.");
      }

      setAnalysisData(data)

    } catch (err: any) {
      console.error("Analysis Error:", err)
      setError(err.message || "An unexpected error occurred during analysis.")
    } finally {
      setIsAnalyzing(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b px-6 py-4 flex items-center gap-4 sticky top-0 z-50">
        <div className="bg-red-600 rounded-full p-2">
            {/* Indian Railways Logo Placeholder */}
            <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center text-red-600 font-bold text-xs">IR</div>
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Railway Geo-Analytics Platform</h1>
          <p className="text-xs text-slate-500 font-medium">WEST CENTRAL RAILWAY • JABALPUR DIVISION</p>
        </div>
      </header>

      <main className="flex-1 p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* --- LEFT SIDEBAR (Configuration) --- */}
        <div className="lg:col-span-3 space-y-6">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-3">
                <CardTitle className="text-base">Upload Data</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Signal Data */}
                <div className="space-y-2">
                    <Label className="text-xs font-semibold text-slate-500">Signal Data (Optional)</Label>
                    <div className="border-2 border-dashed border-slate-200 rounded-md p-3 hover:bg-slate-50 transition-colors cursor-pointer relative">
                        <Input 
                            type="file" 
                            accept=".csv" 
                            className="absolute inset-0 opacity-0 cursor-pointer" 
                            onChange={(e) => setSignalFile(e.target.files?.[0] || null)}
                        />
                        <div className="flex items-center gap-2 text-sm text-slate-600">
                            <Upload className="w-4 h-4" />
                            <span className="truncate">{signalFile ? signalFile.name : "Choose file signals.csv"}</span>
                        </div>
                    </div>
                </div>

                {/* GPS Data */}
                <div className="space-y-2">
                    <Label className="text-xs font-semibold text-slate-500">GPS/OHE Data (Required)</Label>
                    <div className="border-2 border-dashed border-slate-200 rounded-md p-3 hover:bg-slate-50 transition-colors cursor-pointer relative">
                        <Input 
                            type="file" 
                            accept=".csv" 
                            className="absolute inset-0 opacity-0 cursor-pointer" 
                            onChange={(e) => setGpsFile(e.target.files?.[0] || null)}
                        />
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
                {/* Date Inputs - FIXED WITH STEP="60" */}
                <div className="grid grid-cols-1 gap-3">
                    <div className="space-y-1.5">
                        <Label className="text-xs text-slate-500">Departure Time</Label>
                        <div className="relative">
                            <Input 
                                type="datetime-local" 
                                step="60" 
                                value={config.departureTime}
                                onChange={(e) => setConfig({...config, departureTime: e.target.value})}
                                className="pl-9 text-sm"
                            />
                            <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none"/>
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs text-slate-500">Arrival Time</Label>
                        <div className="relative">
                            <Input 
                                type="datetime-local" 
                                step="60" 
                                value={config.arrivalTime}
                                onChange={(e) => setConfig({...config, arrivalTime: e.target.value})}
                                className="pl-9 text-sm"
                            />
                            <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none"/>
                        </div>
                    </div>
                </div>

                {/* Train Type */}
                <div className="space-y-1.5">
                    <Label className="text-xs text-slate-500">Train Type</Label>
                    <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-md">
                        <button 
                            onClick={() => setConfig({...config, trainType: 'passenger'})}
                            className={`flex items-center justify-center gap-2 text-xs font-medium py-1.5 rounded-sm transition-all ${config.trainType === 'passenger' ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            <Train className="w-3.5 h-3.5" /> Passenger
                        </button>
                        <button 
                            onClick={() => setConfig({...config, trainType: 'goods'})}
                            className={`flex items-center justify-center gap-2 text-xs font-medium py-1.5 rounded-sm transition-all ${config.trainType === 'goods' ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            <Truck className="w-3.5 h-3.5" /> Goods
                        </button>
                    </div>
                </div>

                {/* MPS & Match Dist */}
                <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                        <Label className="text-xs text-slate-500">MPS (km/h)</Label>
                        <Input 
                            type="number" 
                            value={config.mps} 
                            onChange={(e) => setConfig({...config, mps: e.target.value})}
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs text-slate-500">Match Dist (m)</Label>
                        <Input 
                            type="number" 
                            value={config.matchDist} 
                            onChange={(e) => setConfig({...config, matchDist: e.target.value})}
                        />
                    </div>
                </div>

                {/* Caution Orders */}
                <div className="pt-2 border-t">
                    <div className="flex items-center justify-between mb-2">
                        <Label className="text-sm font-semibold">Caution Orders</Label>
                        <span className="text-xs bg-slate-100 px-2 py-0.5 rounded-full text-slate-600">{cautionOrders.length} Active</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mb-2">
                         <Label className="text-[10px] text-slate-400">Start (km)</Label>
                         <Label className="text-[10px] text-slate-400">End (km)</Label>
                         <Label className="text-[10px] text-slate-400">Kmph</Label>
                    </div>
                    
                    <div className="space-y-2 max-h-[150px] overflow-y-auto pr-1">
                        {cautionOrders.map((co) => (
                            <div key={co.id} className="grid grid-cols-[1fr_1fr_0.8fr_auto] gap-2 items-center">
                                <Input className="h-7 text-xs px-2" placeholder="Start" value={co.start} onChange={(e) => handleCautionChange(co.id, 'start', e.target.value)} />
                                <Input className="h-7 text-xs px-2" placeholder="End" value={co.end} onChange={(e) => handleCautionChange(co.id, 'end', e.target.value)} />
                                <Input className="h-7 text-xs px-2" placeholder="Speed" value={co.speed} onChange={(e) => handleCautionChange(co.id, 'speed', e.target.value)} />
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-red-500" onClick={() => handleRemoveCautionOrder(co.id)}>
                                    <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                            </div>
                        ))}
                    </div>
                    <Button variant="secondary" size="sm" className="w-full mt-2 text-xs gap-1 h-8" onClick={handleAddCautionOrder}>
                        <Plus className="w-3.5 h-3.5" /> Add Caution Order
                    </Button>
                </div>
            </CardContent>
            
            <div className="p-4 pt-0">
                <Button 
                    className="w-full bg-[#1e293b] hover:bg-[#0f172a] text-white" 
                    onClick={handleAnalysis} 
                    disabled={isAnalyzing || !gpsFile}
                >
                    {isAnalyzing ? (
                        <span className="flex items-center gap-2"><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/> Processing...</span>
                    ) : (
                        <span className="flex items-center gap-2"><Play className="w-4 h-4"/> Run Analysis</span>
                    )}
                </Button>
            </div>
          </Card>

          {/* Error Message Display */}
          {error && (
            <Alert variant="destructive" className="bg-red-50 text-red-900 border-red-200">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Analysis Error</AlertTitle>
                <AlertDescription className="text-xs mt-1">{error}</AlertDescription>
            </Alert>
          )}
        </div>

        {/* --- RIGHT CONTENT AREA (Analysis Results) --- */}
        <div className="lg:col-span-9">
            {analysisData ? (
                <AnalysisResults data={analysisData} />
            ) : (
                <div className="h-full min-h-[500px] flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-lg bg-slate-50/50 text-slate-400">
                    <div className="bg-white p-4 rounded-full shadow-sm mb-4">
                        <Info className="w-8 h-8 text-slate-300" />
                    </div>
                    <h3 className="font-semibold text-lg text-slate-600">No Analysis Generated</h3>
                    <p className="text-sm max-w-sm text-center mt-2">Upload your GPS CSV data and configure the parameters on the left sidebar to generate a speed analysis report.</p>
                </div>
            )}
        </div>

      </main>
    </div>
  )
}
