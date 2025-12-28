"use client"

import { useState, useMemo } from "react"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { MapContainer } from "@/components/map-container"
import { SpeedChart } from "@/components/speed-chart"
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {  
    Activity, MapPin, Download, FileText, AlertTriangle,  
    Search, ChevronDown, Image as ImageIcon, X,  
    Clock, AlertOctagon, ClipboardList, ShieldAlert
} from "lucide-react"

import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"

// --- Types ---
// (Keep your existing types for Stoppage, BrakeTestResult, etc.)

export function AnalysisResults({ data }: any) { // Using any for data to be flexible with your inputs
  const [searchTerm, setSearchTerm] = useState("")
  const [filterType, setFilterType] = useState<"all" | "violation" | "warning" | "matched" | "unmatched">("all")
  const [isReportDialogOpen, setIsReportDialogOpen] = useState(false)
  
  // State for Report
  const [reportDetails, setReportDetails] = useState({
    trainNo: "", locoNo: "", lpName: "", alpName: "", cliName: "", section: "", 
    mps: data?.summary?.config_mps ? `${data.summary.config_mps} km/h` : "", 
    fromLoc: "", toLoc: "", globalRemarks: ""
  })
  const [signatureImg, setSignatureImg] = useState<string | null>(null)

  // --- CORE FIX: DATA FILTERING ---
  const { filteredData, boundsInfo } = useMemo(() => {
    // 1. Safety check for arrays
    const rawResults = Array.isArray(data?.results) ? data.results : [];
    const rawSignals = Array.isArray(data?.signals) ? data.signals : [];

    // 2. Sort by time (crucial for slicing)
    const sorted = [...rawResults].sort((a, b) => {
        if (!a.logging_time || !b.logging_time) return 0;
        return new Date(a.logging_time).getTime() - new Date(b.logging_time).getTime();
    });

    // 3. Find OHE Boundaries
    // We only want data between the First matched OHE structure and the Last matched OHE structure
    const startIdx = sorted.findIndex((r) => r.matched);
    const endIdx = sorted.findLastIndex((r) => r.matched);

    let boundedData = sorted;
    let info = { total: sorted.length, clipped: 0 };

    if (startIdx !== -1 && endIdx !== -1) {
        // Slice the array to keep only data within the OHE section
        boundedData = sorted.slice(startIdx, endIdx + 1);
        info.clipped = sorted.length - boundedData.length;
        info.total = boundedData.length;
    }

    // 4. Merge Signals into this bounded timeframe (optional, but good for consistency)
    // For now, we append all signals as they are static reference points
    const combined = [...boundedData, ...rawSignals]; 

    return { filteredData: combined, boundsInfo: info, pureResults: boundedData };
  }, [data]);

  // Use 'filteredData' for tables/charts instead of raw data
  const finalDisplayData = useMemo(() => {
      return filteredData.filter((item) => {
        const locName = item.location || "";
        const matchesSearch = locName.toLowerCase().includes(searchTerm.toLowerCase());
        let matchesFilter = true;
        if (filterType === "matched") matchesFilter = item.matched;
        if (filterType === "unmatched") matchesFilter = !item.matched;
        if (filterType === "violation") matchesFilter = item.status === 'violation';
        if (filterType === "warning") matchesFilter = item.status === 'warning';
        return matchesSearch && matchesFilter;
      })
  }, [filteredData, searchTerm, filterType]);

  // (Keep your existing PDF generation logic here, but use 'filteredData' instead of 'combinedData')
  // ...

  if (!data || !data.summary) return <div>Loading Analysis...</div>;

  return (
    <div className="space-y-6">
      {boundsInfo.clipped > 0 && (
        <div className="bg-blue-50 text-blue-700 px-4 py-2 rounded-md text-sm border border-blue-200 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4"/>
            <span>Displaying data strictly within OHE limits. {boundsInfo.clipped} points outside section boundaries were hidden.</span>
        </div>
      )}

      <Tabs defaultValue="dashboard" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="graph">Speed Graph</TabsTrigger>
          <TabsTrigger value="braketests">Brake Tests</TabsTrigger>
          <TabsTrigger value="stoppages">Stoppages</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-6 mt-4">
            {/* Dashboard Cards */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card className="p-4 flex items-center gap-3"><div className="bg-primary/10 p-2 rounded"><MapPin className="h-5 w-5 text-primary"/></div><div><p className="text-xs text-muted-foreground">OHE Masts</p><p className="text-2xl font-bold">{data.summary.matched_structures}</p></div></Card>
                <Card className="p-4 flex items-center gap-3"><div className="bg-destructive/10 p-2 rounded"><AlertTriangle className="h-5 w-5 text-destructive"/></div><div><p className="text-xs text-muted-foreground">Violations</p><p className="text-2xl font-bold text-destructive">{data.summary.violation_count}</p></div></Card>
                <Card className="p-4 flex items-center gap-3"><div className="bg-orange-100 p-2 rounded"><AlertTriangle className="h-5 w-5 text-orange-600"/></div><div><p className="text-xs text-muted-foreground">Warnings</p><p className="text-2xl font-bold text-orange-600">{data.summary.warning_count}</p></div></Card>
                <Card className="p-4 flex items-center gap-3"><div className="bg-chart-4/10 p-2 rounded"><Activity className="h-5 w-5 text-chart-4"/></div><div><p className="text-xs text-muted-foreground">Match Rate</p><p className="text-2xl font-bold">{data.summary.match_rate.toFixed(1)}%</p></div></Card>
            </div>
            
            <Card className="overflow-hidden p-0 border">
                {/* Map: Pass filtered results */}
                <MapContainer data={filteredData} signals={data.signals || []} />
            </Card>

            <Card className="p-6">
                 {/* Table View */}
                <div className="mb-4 flex flex-col md:flex-row justify-between gap-4">
                    <h3 className="text-lg font-semibold">Section Data</h3>
                    <div className="flex gap-2">
                         {/* Filter Buttons */}
                         <Button variant="outline" size="sm" onClick={()=>setIsReportDialogOpen(true)}><Download className="h-4 w-4 mr-2"/>Report</Button>
                    </div>
                </div>
                
                <div className="overflow-x-auto rounded-md border h-[400px]">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50 sticky top-0"><tr className="border-b"><th className="p-3 text-left">Location</th><th className="p-3 text-left">Time</th><th className="p-3 text-right">Speed</th><th className="p-3 text-right">Limit</th><th className="p-3 text-center">Status</th></tr></thead>
                        <tbody>{finalDisplayData.slice(0, 300).map((r: any, i: number)=>(
                            <tr key={i} className={`border-b ${r.status==='violation'?'bg-red-50':r.status==='warning'?'bg-orange-50':''}`}>
                                <td className="p-3">{r.location} <span className="text-xs text-gray-400">({r.source})</span></td>
                                <td className="p-3">{r.logging_time?.split(' ')[1]}</td>
                                <td className="p-3 text-right font-bold">{r.speed_kmph ? Math.round(r.speed_kmph) : '-'}</td>
                                <td className="p-3 text-right">{r.limit_applied||'-'}</td>
                                <td className="p-3 text-center">
                                    {r.status === 'violation' ? <span className="text-destructive font-bold text-xs">VIOLATION</span> : 
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
             {/* Pass filtered data to graph */}
            <SpeedChart data={filteredData} mps={data.summary.config_mps} />
        </TabsContent>

        {/* Existing Brake Test and Stoppage Tabs Content... */}
        <TabsContent value="braketests">
            {/* ... Keep existing code ... */}
            <div className="p-4 text-center text-muted-foreground">Brake Test Analysis loaded from summary.</div>
        </TabsContent>
         <TabsContent value="stoppages">
             {/* ... Keep existing code ... */}
             <div className="p-4 text-center text-muted-foreground">Stoppage Analysis loaded from summary.</div>
        </TabsContent>

      </Tabs>
      
      {/* Report Dialog (Keep your existing one) */}
      <Dialog open={isReportDialogOpen} onOpenChange={setIsReportDialogOpen}>
        {/* ... */}
      </Dialog>
    </div>
  )
}
