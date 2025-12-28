"use client"

import { useState, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts"

interface SpeedChartProps {
  data: Array<{
    location: string;
    speed_kmph: number | null;
    limit_applied: number | null;
    status: string;
  }>;
  mps: number;
}

export function SpeedChart({ data, mps }: SpeedChartProps) {
  // 1. Filter valid data points for the chart
  const chartData = useMemo(() => {
    return data
      .filter(d => d.speed_kmph !== null) // Only points with speed
      .map(d => ({
        name: d.location,
        speed: d.speed_kmph,
        limit: d.limit_applied || mps, // Fallback to MPS if no specific limit
        isViolation: d.status === 'violation'
      }));
  }, [data, mps]);

  // 2. Range State (Indices)
  const [range, setRange] = useState([0, Math.min(100, chartData.length)]); // Default show first 100 points

  // Slice data based on range
  const visibleData = useMemo(() => {
    // Safety check
    if (chartData.length === 0) return [];
    const start = Math.floor((range[0] / 100) * chartData.length);
    const end = Math.floor((range[1] / 100) * chartData.length);
    // Ensure start < end
    return chartData.slice(Math.min(start, end), Math.max(start, end) || start + 10);
  }, [chartData, range]);

  if (chartData.length === 0) {
    return <div className="p-8 text-center text-muted-foreground">No speed data available for chart.</div>;
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Speed Profile vs OHE Location</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[400px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={visibleData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis 
                dataKey="name" 
                tick={{ fontSize: 10 }} 
                interval="preserveStartEnd"
                minTickGap={30}
              />
              <YAxis 
                label={{ value: 'Speed (kmph)', angle: -90, position: 'insideLeft' }} 
                domain={[0, (dataMax: number) => Math.max(dataMax, mps + 20)]} 
              />
              <Tooltip 
                contentStyle={{ borderRadius: '8px', fontSize: '12px' }}
                labelStyle={{ fontWeight: 'bold', color: '#333' }}
              />
              <Legend verticalAlign="top" height={36}/>
              
              {/* Reference Lines */}
              <ReferenceLine y={mps} label="MPS" stroke="red" strokeDasharray="3 3" />
              
              {/* Lines */}
              <Line 
                type="monotone" 
                dataKey="speed" 
                stroke="#2563eb" 
                strokeWidth={2} 
                name="Actual Speed"
                dot={false} 
                activeDot={{ r: 6 }}
              />
              <Line 
                type="stepAfter" 
                dataKey="limit" 
                stroke="#dc2626" 
                strokeWidth={2} 
                name="Speed Limit" 
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Range Slider */}
        <div className="mt-6 px-2 space-y-4">
            <div className="flex justify-between text-xs text-muted-foreground font-mono">
                <span>Start: {visibleData[0]?.name || "N/A"}</span>
                <span>Range Selector</span>
                <span>End: {visibleData[visibleData.length - 1]?.name || "N/A"}</span>
            </div>
            <Slider
              defaultValue={[0, 20]} // Default zoom to first 20%
              max={100}
              step={1}
              minStepsBetweenThumbs={5}
              value={range}
              onValueChange={setRange}
              className="cursor-pointer"
            />
            <p className="text-center text-xs text-muted-foreground">
                Showing {visibleData.length} data points
            </p>
        </div>
      </CardContent>
    </Card>
  )
}
