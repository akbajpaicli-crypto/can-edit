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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { 
    Activity, MapPin, TrendingUp, Download, FileText, AlertTriangle, 
    Search, ChevronDown, FileWarning, Image as ImageIcon, X, 
    Clock, AlertOctagon, ClipboardList 
} from "lucide-react"

import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"

// --- Types ---
interface Stoppage {
  location: string;
  arrivalTime: string;
  departureTime: string;
  durationMin: number;
  isSignal?: boolean;
}

interface BrakeTestResult {
  type: 'BFT' | 'BPT';
  status: 'proper' | 'improper' | 'not_performed';
  startSpeed: number;
  lowestSpeed: number;
  dropAmount: number;
  location: string;
  timestamp: string;
  details?: string;
}

interface HaltApproachViolation {
  haltLocation: string;
  checkpoint: string;
  limit: number;
  actualSpeed: number;
  timestamp: string;
}

interface AnalysisResultProps {
  data: {
    summary: {
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
      train_type: 'passenger' | 'goods';
      stoppages: Stoppage[];
      brake_tests: BrakeTestResult[];
      halt_approach_violations: HaltApproachViolation[];
    };
    results: Array<any>;
    signals: Array<any>;
  }
}

// --- Helper: Searchable Input ---
function LocationAutocomplete({ value, onChange, options, placeholder }: { value: string, onChange: (val: string) => void, options: string[], placeholder: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  
  const filteredOptions = useMemo(() => {
    if (!value) return options.slice(0, 100); 
    const lowerVal = value.toLowerCase();
    return options.filter(item => item.toLowerCase().includes(lowerVal)).slice(0, 100);
  }, [options, value]);

  return (
    <div className="relative group">
      <div className="relative">
        <Input
          value={value}
          onChange={(e) => { onChange(e.target.value); setIsOpen(true); }}
          onFocus={() => { setIsOpen(true); setIsFocused(true); }}
          onBlur={() => { setTimeout(() => { setIsOpen(false); setIsFocused(false); }, 200); }}
          placeholder={placeholder}
          className="pr-8"
        />
        <div className="absolute right-2 top-2.5 text-muted-foreground pointer-events-none">
            {isFocused ? <Search className="h-4 w-4 opacity-50"/> : <ChevronDown className="h-4 w-4 opacity-50"/>}
        </div>
      </div>
      {isOpen && filteredOptions.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-[2000] mt-1 max-h-60 overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md">
           {filteredOptions.map((option, idx) => (
             <div key={idx} className="cursor-pointer px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground" onMouseDown={(e) => { e.preventDefault(); onChange(option); setIsOpen(false); }}>{option}</div>
           ))}
        </div>
      )}
    </div>
  )
}

export function AnalysisResults({ data }: AnalysisResultProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [filterType, setFilterType] = useState<"all" | "violation" | "warning" | "matched" | "unmatched">("all")
  const [isReportDialogOpen, setIsReportDialogOpen] = useState(false)
  
  const [reportDetails, setReportDetails] = useState({
    trainNo: "", 
    locoNo: "", 
    lpName: "", 
    alpName: "", 
    cliName: "", 
    section: "", 
    trainType: data.summary.train_type || "goods", 
    mps: data.summary.config_mps ? `${data.summary.config_mps} km/h` : "", 
    fromLoc: "", 
    toLoc: "", 
    globalRemarks: ""
  })
  const [signatureImg, setSignatureImg] = useState<string | null>(null)

  const combinedData = useMemo(() => {
    const all = [...data.results, ...data.signals];
    return all.sort((a, b) => (a.logging_time && b.logging_time) ? new Date(a.logging_time).getTime() - new Date(b.logging_time).getTime() : 0);
  }, [data.results, data.signals]);

  const locOptions = useMemo(() => Array.from(new Set(combinedData.map(r => r.location))).sort(), [combinedData]);

  const filteredResults = useMemo(() => {
    return combinedData.filter((item) => {
      const locName = item.location || "";
      const matchesSearch = locName.toLowerCase().includes(searchTerm.toLowerCase());
      let matchesFilter = true;
      if (filterType === "matched") matchesFilter = item.matched;
      if (filterType === "unmatched") matchesFilter = !item.matched;
      if (filterType === "violation") matchesFilter = item.status === 'violation';
      if (filterType === "warning") matchesFilter = item.status === 'warning';
      return matchesSearch && matchesFilter;
    })
  }, [combinedData, searchTerm, filterType])

  const handleSignatureUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          const reader = new FileReader();
          reader.onloadend = () => setSignatureImg(reader.result as string);
          reader.readAsDataURL(file);
      }
  };

  const generatePDFHeader = (doc: any, title: string) => {
    const pageWidth = doc.internal.pageSize.getWidth();
    doc.setFontSize(18); doc.text(title, pageWidth / 2, 15, { align: "center" });
    doc.setFontSize(10);
    
    let yPos = 25; 
    const leftMargin = 14; 
    const col2X = 110; 
    const rowHeight = 6;
    
    const allFields = [
        { label: "Train No", value: reportDetails.trainNo }, 
        { label: "Train Type", value: reportDetails.trainType.toUpperCase() },
        { label: "Loco No", value: reportDetails.locoNo }, 
        { label: "Section", value: reportDetails.section },
        { label: "LP Name", value: reportDetails.lpName }, 
        { label: "ALP Name", value: reportDetails.alpName },
        { label: "CLI Name", value: reportDetails.cliName }, 
        { label: "MPS", value: reportDetails.mps },
        { label: "Remarks", value: reportDetails.globalRemarks },
    ];

    const activeFields = allFields.filter(f => f.value && f.value.trim() !== "");
    for (let i = 0; i < activeFields.length; i += 2) {
        doc.text(`${activeFields[i].label}: ${activeFields[i].value}`, leftMargin, yPos);
        if (i + 1 < activeFields.length) doc.text(`${activeFields[i+1].label}: ${activeFields[i+1].value}`, col2X, yPos);
        yPos += rowHeight;
    }
    return activeFields.length > 0 ? yPos + 4 : yPos;
  };

  const handleDownloadFullReport = () => {
    const doc = new jsPDF();
    let yPos = generatePDFHeader(doc, "Full Speed Analysis Report");
    
    let reportData = combinedData;
    if (reportDetails.fromLoc && reportDetails.toLoc) {
        const fromIdx = combinedData.findIndex(r => r.location === reportDetails.fromLoc);
        const toIdx = combinedData.findIndex(r => r.location === reportDetails.toLoc);
        if (fromIdx !== -1 && toIdx !== -1) {
             const start = Math.min(fromIdx, toIdx); const end = Math.max(fromIdx, toIdx);
             reportData = combinedData.slice(start, end + 1);
        }
    }

    autoTable(doc, {
      startY: yPos,
      head: [["Location", "Type", "Time", "Speed", "Limit", "Status"]],
      body: reportData.map(row => [
        row.location, 
        row.source, 
        row.logging_time ? row.logging_time.split(' ')[1] : "-",
        row.speed_kmph ? Math.round(row.speed_kmph).toString() : "-", 
        row.limit_applied ? row.limit_applied.toString() : "-",
        row.status === 'violation' ? "VIOLATION" : row.status === 'warning' ? "WARNING" : (row.matched ? "OK" : "No Data")
      ]),
      theme: 'grid', 
      headStyles: { fillColor: [41, 128, 185] }, 
      styles: { fontSize: 8 },
      didParseCell: function(data) {
          if (data.section === 'body') {
              if (data.row.raw[5] === 'VIOLATION') { data.cell.styles.textColor = [220, 38, 38]; data.cell.styles.fontStyle = 'bold'; }
              else if (data.row.raw[5] === 'WARNING') { data.cell.styles.textColor = [217, 119, 6]; data.cell.styles.fontStyle = 'bold'; }
          }
      }
    });
    doc.save(`full_report_${reportDetails.trainNo}.pdf`); 
    setIsReportDialogOpen(false);
  }

  const handleDownloadSummaryReport = () => {
    const doc = new jsPDF();
    let yPos = generatePDFHeader(doc, "Report Summary");

    doc.setFontSize(12); doc.setTextColor(0); doc.text("1. Brake Test Results", 14, yPos + 10);
    yPos += 14;
    
    if (data.summary.brake_tests.length === 0) {
        doc.setFontSize(10); doc.setTextColor(100); doc.text("No Brake Tests recorded.", 14, yPos); yPos += 10;
    } else {
        autoTable(doc, {
            startY: yPos,
            // Format: Speed Drop Arrow
            head: [["Type", "Speed Drop (Start -> End)", "Status", "Loc", "Time"]],
            body: data.summary.brake_tests.map(t => [
                t.type, 
                `${t.startSpeed} → ${t.lowestSpeed} km/h`, 
                t.status.toUpperCase().replace('_', ' '),
                t.location,
                t.timestamp?.split(' ')[1]
            ]),
            theme: 'grid', headStyles: { fillColor: [71, 85, 105] }, styles: { fontSize: 9 },
            didParseCell: function(data) {
                if(data.column.index === 2 && data.section === 'body') {
                    const status = data.cell.raw as string;
                    if(status.includes('PROPER')) data.cell.styles.textColor = [22, 163, 74];
                    else if(status.includes('NOT')) data.cell.styles.textColor = [100, 116, 139];
                    else data.cell.styles.textColor = [220, 38, 38];
                    data.cell.styles.fontStyle = 'bold';
                }
            }
        });
        yPos = (doc as any).lastAutoTable.finalY + 10;
    }

    doc.setFontSize(12); doc.setTextColor(0); doc.text("2. Stoppages & Halt Violations", 14, yPos);
    yPos += 4;
    
    if (data.summary.stoppages.length > 0) {
        autoTable(doc, {
            startY: yPos,
            head: [["Location", "Type", "Arrival", "Departure", "Duration"]],
            body: data.summary.stoppages.map(s => [
                s.location, 
                s.isSignal ? "Signal Stop" : "Generic Stop",
                s.arrivalTime.split(' ')[1], 
                s.departureTime.split(' ')[1], 
                `${s.durationMin} min`
            ]),
            theme: 'grid', headStyles: { fillColor: [71, 85, 105] }, styles: { fontSize: 9 }
        });
        yPos = (doc as any).lastAutoTable.finalY + 10;
    } else {
        yPos += 6; doc.setFontSize(10); doc.setTextColor(100); doc.text("No Stoppages detected.", 14, yPos); yPos += 10;
    }

    if (data.summary.halt_approach_violations.length > 0) {
        doc.setFontSize(10); doc.setTextColor(220, 38, 38); doc.text("Signal Approach Speed Violations:", 14, yPos);
        yPos += 4;
        autoTable(doc, {
            startY: yPos,
            head: [["Signal Location", "Checkpoint", "Limit", "Actual Speed", "Time"]],
            body: data.summary.halt_approach_violations.map(v => [
                v.haltLocation, 
                v.checkpoint, 
                `${v.limit} km/h`, 
                `${Math.round(v.actualSpeed)} km/h`, 
                v.timestamp.split(' ')[1]
            ]),
            theme: 'grid', headStyles: { fillColor: [220, 38, 38] }, styles: { fontSize: 9 }
        });
        yPos = (doc as any).lastAutoTable.finalY + 10;
    }

    doc.setFontSize(12); doc.setTextColor(0); doc.text("3. Speed Violations Summary", 14, yPos);
    yPos += 4;

    const violations = combinedData.filter(r => r.status === 'violation')
        .sort((a, b) => new Date(a.logging_time).getTime() - new Date(b.logging_time).getTime());

    if (violations.length === 0) {
         yPos += 6; doc.setFontSize(10); doc.setTextColor(100); doc.text("No Speed Violations detected.", 14, yPos);
    } else {
        interface Group { from: string; to: string; limit: number; maxSpeed: number; startTime: string; endTime: string; lastLat: number; lastLon: number; }
        const getDist = (lat1: number, lon1: number, lat2: number, lon2: number) => {
            const R = 6371e3; const φ1 = lat1 * Math.PI/180; const φ2 = lat2 * Math.PI/180;
            const a = Math.sin((lat2-lat1)*Math.PI/180/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin((lon2-lon1)*Math.PI/180/2)**2;
            return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        };
        
        const groups: Group[] = [];
        let current: Group = {
            from: violations[0].location, to: violations[0].location, limit: violations[0].limit_applied, maxSpeed: Math.round(violations[0].speed_kmph),
            startTime: violations[0].logging_time, endTime: violations[0].logging_time, lastLat: violations[0].latitude, lastLon: violations[0].longitude
        };

        for (let i = 1; i < violations.length; i++) {
            const row = violations[i]; const rowSpeed = Math.round(row.speed_kmph);
            const dist = getDist(current.lastLat, current.lastLon, row.latitude, row.longitude);
            
            if (row.limit_applied === current.limit && dist < 200) {
                current.to = row.location; 
                current.maxSpeed = Math.max(current.maxSpeed, rowSpeed);
                current.lastLat = row.latitude; 
                current.lastLon = row.longitude;
            } else {
                groups.push(current);
                current = { from: row.location, to: row.location, limit: row.limit_applied, maxSpeed: rowSpeed, startTime: row.logging_time, endTime: row.logging_time, lastLat: row.latitude, lastLon: row.longitude };
            }
        }
        groups.push(current);

        autoTable(doc, {
            startY: yPos,
            head: [["From", "To", "Time", "Limit", "Max Speed", "Signature", "Remarks"]],
            body: groups.map(g => [ g.from, g.to, g.startTime ? g.startTime.split(' ')[1] : "-", `${g.limit}`, `${g.maxSpeed}`, "", "" ]),
            theme: 'grid', headStyles: { fillColor: [220, 38, 38] },
            columnStyles: { 5: { minCellHeight: 15, cellWidth: 30 }, 6: { cellWidth: 40 } },
            didDrawCell: function(data) { if (data.column.index === 5 && data.section === 'body' && signatureImg) doc.addImage(signatureImg, 'PNG', data.cell.x + 2, data.cell.y + 2, 25, 10); }
        });
    }

    doc.save(`report_summary_${reportDetails.trainNo}.pdf`);
    setIsReportDialogOpen(false);
  }

  return (
    <div className="space-y-6">
      <Tabs defaultValue="dashboard" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="dashboard">Analysis Dashboard</TabsTrigger>
          <TabsTrigger value="graph">Speed Graph</TabsTrigger>
          <TabsTrigger value="braketests">Brake Tests</TabsTrigger>
          <TabsTrigger value="stoppages">Stoppages & Halts</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-6 mt-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card className="p-4 flex items-center gap-3"><div className="bg-primary/10 p-2 rounded"><MapPin className="h-5 w-5 text-primary"/></div><div><p className="text-xs text-muted-foreground">Total Assets</p><p className="text-2xl font-bold">{combinedData.length}</p></div></Card>
                <Card className="p-4 flex items-center gap-3"><div className="bg-destructive/10 p-2 rounded"><AlertTriangle className="h-5 w-5 text-destructive"/></div><div><p className="text-xs text-muted-foreground">Violations</p><p className="text-2xl font-bold text-destructive">{data.summary.violation_count}</p></div></Card>
                <Card className="p-4 flex items-center gap-3"><div className="bg-orange-100 p-2 rounded"><AlertTriangle className="h-5 w-5 text-orange-600"/></div><div><p className="text-xs text-muted-foreground">Warnings</p><p className="text-2xl font-bold text-orange-600">{data.summary.warning_count}</p></div></Card>
                <Card className="p-4 flex items-center gap-3"><div className="bg-chart-4/10 p-2 rounded"><Activity className="h-5 w-5 text-chart-4"/></div><div><p className="text-xs text-muted-foreground">Match Rate</p><p className="text-2xl font-bold">{data.summary.match_rate.toFixed(1)}%</p></div></Card>
            </div>
            
            <Card className="overflow-hidden p-0">
                <MapContainer data={data.results} signals={data.signals} />
            </Card>
            
            <Card className="p-6">
                <div className="mb-4 flex flex-col md:flex-row justify-between gap-4">
                    <h3 className="text-lg font-semibold">Detailed Data</h3>
                    <div className="flex flex-wrap gap-2">
                        {[{k:"all",l:"All"},{k:"violation",l:"Violations"},{k:"warning",l:"Warnings"},{k:"matched",l:"Matched"}].map(f=><button key={f.k} onClick={()=>setFilterType(f.k as any)} className={`px-3 py-1 text-xs font-medium rounded-sm border ${filterType===f.k?"bg-primary text-white":"bg-white"}`}>{f.l}</button>)}
                        <Button variant="outline" size="sm" onClick={()=>setIsReportDialogOpen(true)}><Download className="h-4 w-4 mr-2"/>Report</Button>
                    </div>
                </div>
                <div className="mb-4"><Input placeholder="Search..." value={searchTerm} onChange={e=>setSearchTerm(e.target.value)}/></div>
                <div className="overflow-x-auto rounded-md border h-[400px]">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50 sticky top-0"><tr className="border-b"><th className="p-3 text-left">Location</th><th className="p-3 text-left">Time</th><th className="p-3 text-right">Speed</th><th className="p-3 text-right">Limit</th><th className="p-3 text-center">Status</th></tr></thead>
                        <tbody>{filteredResults.slice(0,200).map((r,i)=>(<tr key={i} className={`border-b ${r.status==='violation'?'bg-red-50':r.status==='warning'?'bg-orange-50':''}`}><td className="p-3">{r.location} <span className="text-xs text-gray-400">({r.source})</span></td><td className="p-3">{r.logging_time?.split(' ')[1]}</td><td className="p-3 text-right font-bold">{Math.round(r.speed_kmph)}</td><td className="p-3 text-right">{r.limit_applied||'-'}</td><td className="p-3 text-center">
                            {r.status === 'violation' ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-1 text-xs font-bold text-destructive">VIOLATION</span>
                            ) : r.status === 'warning' ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-1 text-xs font-bold text-orange-700">WARNING</span>
                            ) : r.matched ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700">OK</span>
                            ) : (
                                <span className="inline-flex rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-500">No Data</span>
                            )}
                        </td></tr>))}</tbody>
                    </table>
                </div>
            </Card>
        </TabsContent>

        <TabsContent value="graph" className="mt-4">
            <SpeedChart data={combinedData} mps={data.summary.config_mps} />
        </TabsContent>

        <TabsContent value="braketests" className="mt-4 space-y-6">
            <div className="grid gap-6 md:grid-cols-2">
                {data.summary.brake_tests.length === 0 && <p className="text-muted-foreground col-span-2 text-center py-8">No Brake Tests Detected</p>}
                {data.summary.brake_tests.map((test, i) => (
                    <Card key={i} className={`border-l-4 ${test.status === 'proper' ? 'border-l-green-500' : test.status === 'not_performed' ? 'border-l-gray-400' : 'border-l-red-500'}`}>
                        <CardHeader><CardTitle>{test.type === 'BFT' ? 'Brake Feel Test (BFT)' : 'Brake Power Test (BPT)'}</CardTitle></CardHeader>
                        <CardContent className="space-y-2 text-sm">
                            <div className="flex justify-between items-center border-b pb-2"><span>Status:</span><span className={`font-bold uppercase ${test.status === 'proper' ? 'text-green-600' : test.status === 'not_performed' ? 'text-gray-500' : 'text-red-600'}`}>{test.status.replace('_', ' ')}</span></div>
                            
                            {/* UPDATED: Format as per 3rd Pic Requirement */}
                            <div className="grid grid-cols-2 gap-4 py-2">
                                <div><p className="text-xs text-muted-foreground">Start Speed</p><p className="font-medium">{test.startSpeed} km/h</p></div>
                                <div><p className="text-xs text-muted-foreground">End Speed</p><p className="font-medium">{test.lowestSpeed} km/h</p></div>
                            </div>
                            
                            <div className="flex justify-between items-center bg-muted/50 p-2 rounded">
                                <span className="text-xs font-semibold">Speed Drop Achieved:</span>
                                <span className="font-bold text-base">{test.startSpeed} → {test.lowestSpeed}</span>
                            </div>

                            <div className="flex justify-between text-xs pt-2"><span>Location: {test.location}</span><span>Time: {test.timestamp?.split(' ')[1]}</span></div>
                            {test.details && <div className="text-xs text-muted-foreground mt-2 border-t pt-2 italic">{test.details}</div>}
                        </CardContent>
                    </Card>
                ))}
            </div>
        </TabsContent>

        <TabsContent value="stoppages" className="mt-4 space-y-6">
            <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><Clock className="h-5 w-5"/> Detected Stoppages ({data.summary.stoppages.length})</CardTitle></CardHeader>
                <CardContent>
                    <div className="rounded-md border overflow-hidden">
                        <table className="w-full text-sm">
                            <thead className="bg-muted"><tr className="border-b"><th className="p-3 text-left">Arrival</th><th className="p-3 text-left">Departure</th><th className="p-3 text-left">Type</th><th className="p-3 text-left">Location</th></tr></thead>
                            <tbody>
                                {data.summary.stoppages.map((s, i) => (
                                    <tr key={i} className="border-b">
                                        <td className="p-3">{s.arrivalTime.split(' ')[1]}</td>
                                        <td className="p-3">{s.departureTime.split(' ')[1]}</td>
                                        <td className="p-3">{s.isSignal ? <span className="text-blue-600 font-bold bg-blue-50 px-2 py-1 rounded">Signal Stop</span> : "Halt"}</td>
                                        <td className="p-3">{s.location}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>

            <Card className="border-red-200">
                <CardHeader><CardTitle className="flex items-center gap-2 text-destructive"><AlertOctagon className="h-5 w-5"/> Signal Approach Violations</CardTitle></CardHeader>
                <CardContent>
                    {data.summary.halt_approach_violations.length === 0 ? <p className="text-muted-foreground text-sm">No approach violations detected.</p> : (
                        <div className="rounded-md border overflow-hidden">
                            <table className="w-full text-sm">
                                <thead className="bg-red-50"><tr className="border-b"><th className="p-3 text-left">Signal</th><th className="p-3 text-left">Checkpoint</th><th className="p-3 text-left">Limit</th><th className="p-3 text-left">Actual</th><th className="p-3 text-left">Time</th></tr></thead>
                                <tbody>
                                    {data.summary.halt_approach_violations.map((v, i) => (
                                        <tr key={i} className="border-b bg-red-50/50">
                                            <td className="p-3">{v.haltLocation}</td>
                                            <td className="p-3 font-bold">{v.checkpoint}</td>
                                            <td className="p-3">{v.limit}</td>
                                            <td className="p-3 font-bold text-destructive">{Math.round(v.actualSpeed)}</td>
                                            <td className="p-3">{v.timestamp.split(' ')[1]}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={isReportDialogOpen} onOpenChange={setIsReportDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto z-[1500]">
          <DialogHeader><DialogTitle>Generate Report</DialogTitle><DialogDescription>Enter trip details.</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-4">
             <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label>Train No</Label><Input value={reportDetails.trainNo} onChange={e => setReportDetails({...reportDetails, trainNo: e.target.value})} /></div><div className="space-y-2"><Label>Loco No</Label><Input value={reportDetails.locoNo} onChange={e => setReportDetails({...reportDetails, locoNo: e.target.value})} /></div></div>
             
             <div className="grid grid-cols-2 gap-4">
                 <div className="space-y-2">
                     <Label>Train Type</Label>
                     <Select value={reportDetails.trainType} onValueChange={v => setReportDetails({...reportDetails, trainType: v as any})}>
                         <SelectTrigger><SelectValue /></SelectTrigger>
                         <SelectContent>
                             <SelectItem value="passenger">Passenger</SelectItem>
                             <SelectItem value="goods">Goods</SelectItem>
                         </SelectContent>
                     </Select>
                 </div>
                 <div className="space-y-2"><Label>Section</Label><Input value={reportDetails.section} onChange={e => setReportDetails({...reportDetails, section: e.target.value})} /></div>
             </div>

             <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label>LP Name</Label><Input value={reportDetails.lpName} onChange={e => setReportDetails({...reportDetails, lpName: e.target.value})} /></div><div className="space-y-2"><Label>ALP Name</Label><Input value={reportDetails.alpName} onChange={e => setReportDetails({...reportDetails, alpName: e.target.value})} /></div></div>
             <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label>CLI Name</Label><Input value={reportDetails.cliName} onChange={e => setReportDetails({...reportDetails, cliName: e.target.value})} /></div><div className="space-y-2"><Label>MPS</Label><Input value={reportDetails.mps} onChange={e => setReportDetails({...reportDetails, mps: e.target.value})} /></div></div>
             <div className="space-y-2"><Label>Remarks</Label><Input value={reportDetails.globalRemarks} onChange={e => setReportDetails({...reportDetails, globalRemarks: e.target.value})} /></div>
             <div className="space-y-2"><Label>Signature (Image)</Label><div className="flex gap-2 items-center"><Input type="file" accept="image/*" onChange={handleSignatureUpload} className="w-full" />{signatureImg && <Button variant="ghost" size="icon" onClick={() => setSignatureImg(null)}><X className="h-4 w-4" /></Button>}</div>{signatureImg && <p className="text-xs text-green-600 flex items-center gap-1"><ImageIcon className="h-3 w-3"/> Signature Loaded</p>}</div>
             <div className="grid grid-cols-2 gap-4 pt-4 border-t"><div className="space-y-2"><Label>From</Label><LocationAutocomplete value={reportDetails.fromLoc} onChange={v => setReportDetails({...reportDetails, fromLoc: v})} options={locOptions} placeholder="Start..." /></div><div className="space-y-2"><Label>To</Label><LocationAutocomplete value={reportDetails.toLoc} onChange={v => setReportDetails({...reportDetails, toLoc: v})} options={locOptions} placeholder="End..." /></div></div>
          </div>
          <DialogFooter className="sm:justify-between">
            <Button variant="ghost" onClick={() => setIsReportDialogOpen(false)}>Cancel</Button>
            <div className="flex gap-2">
                <Button variant="secondary" onClick={handleDownloadSummaryReport} className="gap-2"><ClipboardList className="h-4 w-4" /> Report Summary</Button>
                <Button onClick={handleDownloadFullReport} className="gap-2"><FileText className="h-4 w-4" /> Full Report</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
