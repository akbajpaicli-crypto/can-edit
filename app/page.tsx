"use client"

import type React from "react"
import { useState } from "react"
import { Upload, MapPin, AlertTriangle, Trash2, Plus, TrainFront, Truck, CalendarClock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AnalysisResults } from "@/components/analysis-results"
import { analyzeData, CautionOrder, TrainType } from "@/lib/analyzer"

export default function Home() {
  const [rtisFile, setRtisFile] = useState<File | null>(null)
  const [oheFile, setOheFile] = useState<File | null>(null)
  const [signalsFile, setSignalsFile] = useState<File | null>(null)
  
  const [maxDistance, setMaxDistance] = useState<number>(50)
  const [globalMPS, setGlobalMPS] = useState<number>(110)
  const [trainType, setTrainType] = useState<TrainType>('passenger')
  
  // NEW: Time Window State
  const [depTime, setDepTime] = useState<string>("")
  const [arrTime, setArrTime] = useState<string>("")
  
  const [cautionOrders, setCautionOrders] = useState<CautionOrder[]>([])
  const [newCO, setNewCO] = useState<CautionOrder>({ startOhe: "", endOhe: "", speedLimit: 0 })

  const [isProcessing, setIsProcessing] = useState(false)
  const [status, setStatus] = useState<{ type: "idle" | "processing" | "success" | "error"; message: string }>({
    type: "idle",
    message: "Ready for Analysis",
  })
  const [results, setResults] = useState<any>(null)

  const handleFileUpload = (setter: (f: File | null) => void, label: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && (file.name.endsWith(".csv") || file.name.endsWith(".xlsx"))) {
        setter(file)
        setStatus({ type: "idle", message: `${label} file uploaded` })
    } else {
        setStatus({ type: "error", message: `Error: Invalid file format for ${label}. Use CSV.` })
    }
  }

  const handleAddCO = () => {
    if (newCO.startOhe && newCO.endOhe && newCO.speedLimit > 0) {
      setCautionOrders([...cautionOrders, newCO])
      setNewCO({ startOhe: "", endOhe: "", speedLimit: 0 }) 
    }
  }

  const handleRemoveCO = (index: number) => {
    setCautionOrders(cautionOrders.filter((_, i) => i !== index))
  }

  const handleAnalyze = async () => {
    if (!rtisFile || (!oheFile && !signalsFile)) {
        setStatus({ type: "error", message: "Error: Missing Data Files." })
        return
    }

    setIsProcessing(true)
    setStatus({ type: "processing", message: "Processing..." })

    try {
      // Pass the new time arguments
      const data = await analyzeData(
          rtisFile, oheFile, signalsFile, 
          maxDistance, globalMPS, cautionOrders, trainType,
          depTime, arrTime // <--- Passed here
      )
      setResults(data)
      setStatus({ type: "success", message: `Success! Processed ${data.summary.total_structures} locations.` })
    } catch (error) {
      console.error(error)
      setStatus({ type: "error", message: "Analysis failed." })
    } finally {
      setIsProcessing(false)
    }
  }

  const canAnalyze = rtisFile && (oheFile || signalsFile) && maxDistance > 0 && globalMPS > 0

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-white shadow-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center gap-4">
            <div className="flex-shrink-0">
               <img src="/logo.png" alt="Railway Logo" className="h-14 w-auto object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            </div>
            <div>
                <h1 className="text-2xl font-bold text-foreground leading-tight tracking-tight">GeoRTIS</h1>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">West Central Railway • Jabalpur Division</p>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto p-4 flex-grow">
        <div className="grid gap-6 lg:grid-cols-[400px_1fr]">
          <div className="space-y-6">
            <Card className="p-6 shadow-md">
              <div className="space-y-6">
                
                {/* 1. File Uploads */}
                <div className="space-y-4 border-b pb-4">
                  <h3 className="font-semibold text-sm flex items-center gap-2"><Upload className="h-4 w-4"/> Data Sources</h3>
                  <div className="space-y-3">
                    <Input type="file" accept=".csv" onChange={handleFileUpload(setRtisFile, "RTIS")} className="cursor-pointer bg-muted/50"/>
                    <Input type="file" accept=".csv" onChange={handleFileUpload(setOheFile, "OHE")} className="cursor-pointer bg-muted/50"/>
                    <Input type="file" accept=".csv" onChange={handleFileUpload(setSignalsFile, "Signal")} className="cursor-pointer bg-muted/50"/>
                  </div>
                </div>

                {/* 2. Configuration */}
                <div className="space-y-4 border-b pb-4">
                  <h3 className="font-semibold text-sm">Configuration</h3>
                  
                  {/* Train Type */}
                  <div className="space-y-2">
                    <Label className="text-xs">Train Type</Label>
                    <div className="grid grid-cols-2 gap-2">
                        <div onClick={() => setTrainType('passenger')} className={`cursor-pointer border rounded-md p-2 flex items-center justify-center gap-2 text-xs transition-colors ${trainType === 'passenger' ? 'bg-primary/10 border-primary text-primary font-bold' : 'hover:bg-muted'}`}>
                            <TrainFront className="h-4 w-4" /> Passenger
                        </div>
                        <div onClick={() => setTrainType('goods')} className={`cursor-pointer border rounded-md p-2 flex items-center justify-center gap-2 text-xs transition-colors ${trainType === 'goods' ? 'bg-primary/10 border-primary text-primary font-bold' : 'hover:bg-muted'}`}>
                            <Truck className="h-4 w-4" /> Goods
                        </div>
                    </div>
                  </div>

                  {/* Time Window (NEW) */}
                  <div className="space-y-2">
                    <Label className="text-xs flex items-center gap-2"><CalendarClock className="h-3 w-3"/> Trip Window (Optional)</Label>
                    <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                            <span className="text-[10px] text-muted-foreground uppercase font-bold">Departure</span>
                            <Input type="datetime-local" className="text-xs h-8" value={depTime} onChange={(e) => setDepTime(e.target.value)} />
                        </div>
                        <div className="space-y-1">
                            <span className="text-[10px] text-muted-foreground uppercase font-bold">Arrival</span>
                            <Input type="datetime-local" className="text-xs h-8" value={arrTime} onChange={(e) => setArrTime(e.target.value)} />
                        </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-2">
                      <div className="space-y-1"><Label className="text-xs">MPS (km/h)</Label><Input type="number" value={globalMPS} onChange={(e) => setGlobalMPS(Number(e.target.value))} /></div>
                      <div className="space-y-1"><Label className="text-xs">Match Dist (m)</Label><Input type="number" value={maxDistance} onChange={(e) => setMaxDistance(Number(e.target.value))} /></div>
                  </div>
                </div>

                {/* 3. Caution Orders */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-sm">Caution Orders</h3>
                      <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{cautionOrders.length} Active</span>
                  </div>
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

                {/* 4. Action */}
                <div className="pt-2">
                    <Button onClick={handleAnalyze} disabled={!canAnalyze || isProcessing} className="w-full font-bold shadow-sm" size="lg">
                    {isProcessing ? <><span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent" /> Analyzing...</> : "Run Analysis"}
                    </Button>
                </div>

                {/* Status */}
                {status.type !== 'idle' && (
                    <div className={`rounded-lg border p-3 text-xs font-medium flex items-center gap-2 ${status.type === "success" ? "border-green-200 bg-green-50 text-green-700" : status.type === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-blue-200 bg-blue-50 text-blue-700"}`}>
                        {status.type === "error" ? <AlertTriangle className="h-4 w-4" /> : <div className="h-2 w-2 rounded-full bg-current animate-pulse"/>}
                        {status.message}
                    </div>
                )}
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

      <footer className="border-t bg-white py-6 mt-8">
        <div className="container mx-auto px-4 text-center">
            <p className="text-sm font-medium text-gray-900">Developed by <span className="font-bold">A. K. Bajpai</span>, CLI Jabalpur</p>
            <p className="text-xs text-muted-foreground mt-1">Guided by <span className="font-semibold text-gray-700">Akshay Kumrawat</span>, Sr. DEE (TRO) Jabalpur</p>
        </div>
      </footer>
    </div>
  )
}
