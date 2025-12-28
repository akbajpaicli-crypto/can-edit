"use client"

import { useEffect, useRef } from "react"

// --- Align Types with Analyzer Output ---
interface MapPoint {
  location: string;
  latitude: number;
  longitude: number;
  speed_kmph: number | null;
  limit_applied: number | null;
  status: 'ok' | 'warning' | 'violation';
  matched: boolean;
  source: 'OHE' | 'Signal';
  logging_time?: string;
}

interface MapContainerProps {
  data?: MapPoint[]    // Combined Results (Optional with default)
  signals?: MapPoint[] // Optional explicit signals
}

export function MapContainer({ data = [], signals = [] }: MapContainerProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<any>(null)

  useEffect(() => {
    // 1. Basic Safety Checks
    if (typeof window === "undefined" || !mapRef.current) return
    
    // Ensure data/signals are arrays (prevents crash if API returns null)
    const safeData = Array.isArray(data) ? data : [];
    const safeSignals = Array.isArray(signals) ? signals : [];

    const loadMap = async () => {
      // 2. Load Leaflet Resources
      if (!document.querySelector('link[href*="leaflet.css"]')) {
        const link = document.createElement("link")
        link.rel = "stylesheet"
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        document.head.appendChild(link)
      }

      if (!(window as any).L) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script")
          script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
          script.onload = () => resolve()
          script.onerror = () => reject(new Error("Failed to load Leaflet"))
          document.head.appendChild(script)
        })
      }

      const L = (window as any).L
      if (!mapRef.current) return
      
      // Cleanup existing map
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
      }

      // 3. Initialize Map (Default Center: India)
      const map = L.map(mapRef.current).setView([20.5937, 78.9629], 5) 
      mapInstanceRef.current = map

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
      }).addTo(map)

      // --- 4. Icon Definitions ---
      
      // A. OHE Icon (Green/Gray Dots)
      const createOheIcon = (color: string) => L.divIcon({
        html: `<div style="background-color: ${color}; width: 10px; height: 10px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.4);"></div>`,
        className: "", 
        iconSize: [10, 10],
        iconAnchor: [5, 5]
      })

      // B. Signal Icon (Improved Visibility)
      const createSignalIcon = () => L.divIcon({
        html: `<br>
          <svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0px 3px 3px rgba(0,0,0,0.6));"><br>
            <rect x="13" y="10" width="4" height="20" fill="#111827" /><br>
            <rect x="9" y="0" width="12" height="18" rx="3" fill="#1f2937" stroke="#f3f4f6" stroke-width="1.5"/><br>
            <circle cx="15" cy="4" r="2" fill="#ef4444" /><br>
            <circle cx="15" cy="9" r="2" fill="#eab308" /><br>
            <circle cx="15" cy="14" r="2" fill="#22c55e" /><br>
          </svg><br>
        `,
        className: "",
        iconSize: [30, 30],
        iconAnchor: [15, 30],
        popupAnchor: [0, -30]
      })

      // C. Violation Icon (Pulsing Red)
      const violationIcon = L.divIcon({
        html: `<br>
          <div style="position: relative; width: 20px; height: 20px;"><br>
            <div style="position: absolute; width: 100%; height: 100%; background-color: #ef4444; opacity: 0.7; border-radius: 50%; animation: ping 1s cubic-bezier(0, 0, 0.2, 1) infinite;"></div><br>
            <div style="position: absolute; top: 3px; left: 3px; width: 14px; height: 14px; background-color: #dc2626; border-radius: 50%; border: 2px solid white;"></div><br>
          </div><br>
          <style>@keyframes ping { 75%, 100% { transform: scale(2); opacity: 0; } }</style><br>
        `,
        className: "",
        iconSize: [20, 20],
        iconAnchor: [10, 10]
      })

      // --- 5. Plot Points ---
      const allPoints = [...safeData, ...safeSignals];
      const bounds = L.latLngBounds([]);
      let validPointsCount = 0;

      allPoints.forEach((point) => {
        // Defensive check: Ensure point exists and coordinates are valid numbers
        if (!point) return;
        
        const lat = Number(point.latitude);
        const lng = Number(point.longitude);

        // Skip if coordinates are NaN, null, or 0 (unless 0 is valid, but usually implies missing data here)
        if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) return;

        let icon;
        let zIndex = 100;

        if (point.status === 'violation') {
            icon = violationIcon;
            zIndex = 1000;
        } 
        else if (point.source === 'Signal') {
            icon = createSignalIcon();
            zIndex = 500; 
        } 
        else if (point.matched) {
            icon = createOheIcon("#16a34a"); 
        } 
        else {
            icon = createOheIcon("#94a3b8");
            zIndex = 50;
        }

        const marker = L.marker([lat, lng], { 
            icon, 
            zIndexOffset: zIndex 
        }).addTo(map)

        bounds.extend([lat, lng])
        validPointsCount++;

        // Popup Content
        const popupContent = `<br>
          <div style="font-family: system-ui; font-size: 12px; min-width: 160px;"><br>
            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 4px;"><br>
                <strong style="font-size:13px">${point.location || 'Unknown Location'}</strong><br>
                <span style="font-size:10px; padding: 2px 4px; border-radius: 4px; background: ${point.source === 'Signal' ? '#dbeafe' : '#f1f5f9'}; color: ${point.source === 'Signal' ? '#1e40af' : '#64748b'}; font-weight: 600;"><br>
                    ${point.source}<br>
                </span><br>
            </div><br>
            <div style="border-top: 1px solid #e2e8f0; padding-top: 6px; margin-top: 4px;"><br>
                ${point.matched ? `<br>
                    <div style="display: grid; grid-template-columns: auto 1fr; gap: 4px 12px;"><br>
                        <span style="color:#64748b">Speed:</span> <br>
                        <strong>${Math.round(point.speed_kmph || 0)} km/h</strong><br>
                        <br>
                        <span style="color:#64748b">Limit:</span> <br>
                        <span>${point.limit_applied || 'N/A'} km/h</span><br>
                        <br>
                        <span style="color:#64748b">Status:</span> <br>
                        <strong style="color: ${point.status === 'violation' ? '#dc2626' : point.status === 'warning' ? '#d97706' : '#16a34a'}"><br>
                            ${point.status.toUpperCase()}<br>
                        </strong><br>
                    </div><br>
                    <div style="margin-top: 6px; font-size: 10px; color: #94a3b8;"><br>
                        Time: ${point.logging_time?.split(' ')[1] || '-'}<br>
                    </div><br>
                ` : `<br>
                    <div style="color: #94a3b8; font-style: italic; padding: 4px 0;"><br>
                        ${point.source === 'Signal' ? 'Signal location' : 'No matching train data found'}<br>
                    </div><br>
                `}<br>
            </div><br>
          </div><br>
        `
        marker.bindPopup(popupContent)
      })

      // --- 6. Legend ---
      const legend = L.control({ position: "bottomright" })
      legend.onAdd = () => {
        const div = L.DomUtil.create("div", "info legend")
        Object.assign(div.style, {
            backgroundColor: "white",
            padding: "8px",
            borderRadius: "6px",
            boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
            fontFamily: "system-ui",
            fontSize: "11px",
            lineHeight: "1.5"
        })
        
        const item = (color: string, label: string, shape: string = '50%') => `<br>
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 2px;"><br>
                <div style="width: 10px; height: 10px; background: ${color}; border-radius: ${shape}; border: 1px solid #cbd5e1;"></div><br>
                <span style="color: #334155;">${label}</span><br>
            </div><br>
        `
        
        div.innerHTML = `<br>
            <strong style="display:block; margin-bottom:4px; color:#0f172a;">Legend</strong><br>
            ${item('#ef4444', 'Violation', '50%')}<br>
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 2px;"><br>
                <div style="width: 10px; height: 14px; background: #1f2937; border-radius: 2px; border: 1px solid white; position: relative;"><br>
                    <div style="width:4px; height:4px; background:#22c55e; border-radius:50%; margin: 8px auto 0 auto;"></div><br>
                </div><br>
                <span style="color: #334155;">Signal</span><br>
            </div><br>
            ${item('#16a34a', 'Matched OHE', '50%')}<br>
            ${item('#94a3b8', 'Unmatched OHE', '50%')}<br>
        `
        return div
      }
      legend.addTo(map)

      // Fit map only if we have valid points
      if (validPointsCount > 0 && bounds.isValid()) {
        try {
            map.fitBounds(bounds, { padding: [50, 50] })
        } catch(e) {
            console.warn("Could not fit bounds:", e);
        }
      }
    }

    loadMap()

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
      }
    }
  }, [data, signals])

  return (
    <div className="relative h-[500px] w-full bg-muted rounded-md overflow-hidden border">
      <div ref={mapRef} className="h-full w-full" style={{ zIndex: 0 }} />
    </div>
  )
}
