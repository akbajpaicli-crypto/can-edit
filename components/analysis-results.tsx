"use client"

import { useState, useMemo } from "react"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { MapContainer } from "@/components/map-container"
import { SpeedChart } from "@/components/speed-chart"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {  
    Activity, MapPin, Download, AlertTriangle,  
    Search, Clock, AlertOctagon, FileText
} from "lucide-react"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"

// --- Types ---
interface Stoppage {
  location: string;
  arrivalTime: string;
  departureTime: string;
  durationMin: number;
}
interface BrakeTestResult {
  type: 'BFT' | 'BPT';
  status: 'proper' | 'improper';
  testSpeed: number;
  finalSpeed: number;
  location: string;
  timestamp: string;
}

interface AnalysisResultsProps {
  data: {
    summary: {
      matched_structures: number;
      match_rate: number;
      violation_count: number;
      warning_count: number;
      config_mps: number;
      stoppages: Stoppage[];
      brake_tests: BrakeTestResult[];
    };
    results: Array<any>;
    signals: Array<any>;
  }
}

export function AnalysisResults({ data }: AnalysisResultsProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [filterType, setFilterType] = useState<"all" | "violation" | "warning" | "signal">("all")

  // Merge Results + Signals for the Master List
  const combinedData = useMemo(() => {
    const r = Array.isArray(data?.results) ? data.results : [];
    const s = Array.isArray(data?.signals) ? data.signals : [];
    // Sort by location name or time
    return [...r, ...s].sort((a, b) => {
        const tA = new Date(a.logging_time || 0).getTime();
        const tB = new Date(b.logging_time || 0).getTime();
        return tA - tB;
    });
  }, [data]);

  const filteredResults = useMemo(() => {
    return combinedData.filter((item) => {
      const locName = item.location || "";
      const matchesSearch = locName.toLowerCase().includes(searchTerm.toLowerCase());
      
      let matchesFilter = true;
      if (filterType === "violation") matchesFilter = item.status === 'violation';
      if (filterType === "warning") matchesFilter = item.status === 'warning';
      if (filterType === "signal") matchesFilter = item.source === 'Signal';
      
      return matchesSearch && matchesFilter;
    })
  }, [combinedData, searchTerm, filterType])

  const handleDownloadReport = () => {
    const doc = new jsPDF();
    doc.text("Speed Analysis Report", 14, 15);
    autoTable(doc, {
      startY: 25,
      head: [["Location", "Type", "Time", "Speed", "Limit", "Status"]],
      body: filteredResults.map(row => [
        row.location, 
        row.source, 
        row.logging_time ? row.logging_time.split('T')[1]?.split('.')[0] : "-",
        row.speed_kmph ? Math.round(row.speed_kmph) : "-", 
        row.limit_applied || "-",
        row.status?.toUpperCase()
      ]),
    });
    doc.save("analysis_report.pdf");
  }

  if (!data || !data.summary) return <div>Loading...</div>;

  return (
    <div className="space-y-6">
      <Tabs defaultValue="dashboard" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="graph">Speed Graph</TabsTrigger>
          <TabsTrigger value="braketests">Brake Tests</TabsTrigger>
          <TabsTrigger value="stoppages">Stoppages</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-6 mt-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card className="p-4 flex items-center gap-3"><div className="bg-primary/10 p-2 rounded"><MapPin className="h-5 w-5 text-primary"/></div><div><p className="text-xs text-muted-foreground">OHE Masts</p><p className="text-2xl font-bold">{data.summary.matched_structures}</p></div></Card>
                <Card className="p-4 flex items-center gap-3"><div className="bg-destructive/10 p-2 rounded"><AlertTriangle className="h-5 w-5 text-destructive"/></div><div><p className="text-xs text-muted-foreground">Violations</p><p className="text-2xl font-bold text-destructive">{data.summary.violation_count}</p></div></Card>
                <Card className="p-4 flex items-center gap-3"><div className="bg-orange-100 p-2 rounded"><AlertTriangle className="h-5 w-5 text-orange-600"/></div><div><p className="text-xs text-muted-foreground">Warnings</p><p className="text-2xl font-bold text-orange-600">{data.summary.warning_count}</p></div></Card>
                <Card className="p-4 flex items-center gap-3"><div className="bg-blue-100 p-2 rounded"><Activity className="h-5 w-5 text-blue-600"/></div><div><p className="text-xs text-muted-foreground">Match Rate</p><p className="text-2xl font-bold">{data.summary.match_rate.toFixed(1)}%</p></div></Card>
            </div>
            
            <Card className="overflow-hidden p-0 border">
                <MapContainer data={data.results} signals={data.signals} />
            </Card>

            <Card className="p-6">
                <div className="flex flex-col md:flex-row justify-between gap-4 mb-4">
                    <h3 className="text-lg font-semibold">Detailed Data</h3>
                    <div className="flex gap-2">
                        {/* SEARCH INPUT */}
                        <div className="relative">
                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input 
                                placeholder="Search location..." 
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-8 w-[200px]"
                            />
                        </div>
                        <Button variant="outline" onClick={handleDownloadReport}><Download className="h-4 w-4 mr-2"/> PDF</Button>
                    </div>
                </div>

                {/* FILTERS */}
                <div className="flex gap-2 mb-4">
                    {[{k:"all",l:"All"}, {k:"violation",l:"Violations"}, {k:"warning",l:"Warnings"}, {k:"signal",l:"Signals"}].map(f => (
                        <button 
                            key={f.k} 
                            onClick={() => setFilterType(f.k as any)}
                            className={`px-3 py-1 text-xs font-medium rounded-full border ${filterType === f.k ? 'bg-slate-900 text-white' : 'bg-white hover:bg-slate-100'}`}
                        >
                            {f.l}
                        </button>
                    ))}
                </div>
                
                <div className="overflow-x-auto rounded-md border h-[400px]">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 sticky top-0"><tr className="border-b"><th className="p-3 text-left">Location</th><th className="p-3 text-left">Type</th><th className="p-3 text-left">Time</th><th className="p-3 text-right">Speed</th><th className="p-3 text-right">Limit</th><th className="p-3 text-center">Status</th></tr></thead>
                        <tbody>{filteredResults.slice(0, 500).map((r: any, i: number)=>(
                            <tr key={i} className={`border-b hover:bg-slate-50 ${r.status==='violation'?'bg-red-50/50':r.status==='warning'?'bg-orange-50/50':''}`}>
                                <td className="p-3 font-medium">{r.location}</td>
                                <td className="p-3"><span className={`text-[10px] px-2 py-1 rounded border ${r.source==='Signal'?'bg-blue-50 text-blue-700 border-blue-200':'bg-slate-100 text-slate-600'}`}>{r.source}</span></td>
                                <td className="p-3 text-slate-500">{r.logging_time?.split('T')[1]?.split('.')[0]}</td>
                                <td className="p-3 text-right font-mono font-bold">{r.speed_kmph ? Math.round(r.speed_kmph) : '-'}</td>
                                <td className="p-3 text-right text-slate-500">{r.limit_applied||'-'}</td>
                                <td className="p-3 text-center">
                                    {r.status === 'violation' ? <span className="text-red-600 font-bold text-xs">VIOLATION</span> : 
                                     r.status === 'warning' ? <span className="text-orange-600 font-bold text-xs">WARNING</span> : 
                                     <span className="text-green-600 text-xs">OK</span>}
                                </td>
                            </tr>
                        ))}</tbody>
                    </table>
                </div>
            </Card>
        </TabsContent>

        <TabsContent value="graph" className="mt-4">
            <SpeedChart data={data.results} mps={data.summary.config_mps} />
        </TabsContent>

        <TabsContent value="braketests" className="mt-4">
             <div className="grid gap-4 md:grid-cols-2">
                {data.summary.brake_tests.length === 0 && <div className="col-span-2 text-center p-8 text-muted-foreground border border-dashed rounded">No Brake Tests Detected</div>}
                {data.summary.brake_tests.map((test, i) => (
                    <Card key={i} className="border-l-4 border-l-blue-500">
                        <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">{test.type === 'BFT' ? 'Brake Feel Test (Running)' : 'Brake Power Test (Stop)'}</CardTitle></CardHeader>
                        <CardContent className="text-sm space-y-1">
                            <div className="flex justify-between"><span>Location:</span> <span className="font-bold">{test.location}</span></div>
                            <div className="flex justify-between"><span>Time:</span> <span>{test.timestamp.split('T')[1].split('.')[0]}</span></div>
                            {test.type === 'BFT' && <div className="flex justify-between text-muted-foreground"><span>Speed Drop:</span> <span>{test.testSpeed} ➝ {test.finalSpeed} km/h</span></div>}
                        </CardContent>
                    </Card>
                ))}
             </div>
        </TabsContent>

        <TabsContent value="stoppages" className="mt-4">
             <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><Clock className="h-5 w-5"/> Detected Stoppages</CardTitle></CardHeader>
                <CardContent>
                    {data.summary.stoppages.length === 0 ? <p className="text-muted-foreground text-center py-8">No Stoppages Detected</p> : (
                        <table className="w-full text-sm">
                            <thead className="bg-slate-50"><tr className="border-b"><th className="p-3 text-left">Location</th><th className="p-3 text-left">Arrival</th><th className="p-3 text-left">Departure</th><th className="p-3 text-right">Duration</th></tr></thead>
                            <tbody>
                                {data.summary.stoppages.map((s, i) => (
                                    <tr key={i} className="border-b">
                                        <td className="p-3 font-medium">{s.location}</td>
                                        <td className="p-3 text-slate-500">{s.arrivalTime.split('T')[1].split('.')[0]}</td>
                                        <td className="p-3 text-slate-500">{s.departureTime.split('T')[1].split('.')[0]}</td>
                                        <td className="p-3 text-right font-bold">{s.durationMin} min</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </CardContent>
            </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
