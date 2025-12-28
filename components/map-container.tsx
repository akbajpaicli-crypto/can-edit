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
}

interface MapContainerProps {
  data: MapPoint[]    // Combined Results
  signals?: MapPoint[] // Optional explicit signals
}

export function MapContainer({ data, signals = [] }: MapContainerProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<any>(null)

  useEffect(() => {
    if (typeof window === "undefined" || !mapRef.current) return

    const loadMap = async () => {
      // 1. Load Leaflet Resources
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
      
      // Cleanup
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
      }

      // 2. Initialize Map
      const map = L.map(mapRef.current).setView([20.5937, 78.9629], 5) 
      mapInstanceRef.current = map

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
      }).addTo(map)

      // --- 3. Icon Definitions ---
      
      // A. OHE Icon (Green/Gray Dots)
      const createOheIcon = (color: string) => L.divIcon({
        html: `<div style="background-color: ${color}; width: 10px; height: 10px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.4);"></div>`,
        className: "", 
        iconSize: [10, 10],
        iconAnchor: [5, 5]
      })

      // B. Signal Icon (Improved Visibility)
      // Thicker pole, larger head, distinct traffic light colors
      const createSignalIcon = () => L.divIcon({
        html: `
          <svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0px 3px 3px rgba(0,0,0,0.6));">
            <rect x="13" y="10" width="4" height="20" fill="#111827" />
            <rect x="9" y="0" width="12" height="18" rx="3" fill="#1f2937" stroke="#f3f4f6" stroke-width="1.5"/>
            <circle cx="15" cy="4" r="2" fill="#ef4444" />
            <circle cx="15" cy="9" r="2" fill="#eab308" />
            <circle cx="15" cy="14" r="2" fill="#22c55e" />
          </svg>
        `,
        className: "", // Empty class to avoid default white square background
        iconSize: [30, 30],
        iconAnchor: [15, 30], // Bottom Center
        popupAnchor: [0, -30]
      })

      // C. Violation Icon (Pulsing Red)
      const violationIcon = L.divIcon({
        html: `
          <div style="position: relative; width: 20px; height: 20px;">
            <div style="position: absolute; width: 100%; height: 100%; background-color: #ef4444; opacity: 0.7; border-radius: 50%; animation: ping 1s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
            <div style="position: absolute; top: 3px; left: 3px; width: 14px; height: 14px; background-color: #dc2626; border-radius: 50%; border: 2px solid white;"></div>
          </div>
          <style>@keyframes ping { 75%, 100% { transform: scale(2); opacity: 0; } }</style>
        `,
        className: "",
        iconSize: [20, 20],
        iconAnchor: [10, 10]
      })

      // --- 4. Plot Points ---
      const allPoints = [...data, ...signals];
      const bounds = L.latLngBounds([]);

      allPoints.forEach((point) => {
        if(!point.latitude || !point.longitude) return;

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

        const marker = L.marker([point.latitude, point.longitude], { 
            icon, 
            zIndexOffset: zIndex 
        }).addTo(map)

        bounds.extend([point.latitude, point.longitude])

        // Popup
        const popupContent = `
          <div style="font-family: system-ui; font-size: 12px; min-width: 160px;">
            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 4px;">
                <strong style="font-size:13px">${point.location}</strong>
                <span style="font-size:10px; padding: 2px 4px; border-radius: 4px; background: ${point.source === 'Signal' ? '#dbeafe' : '#f1f5f9'}; color: ${point.source === 'Signal' ? '#1e40af' : '#64748b'}; font-weight: 600;">
                    ${point.source}
                </span>
            </div>
            <div style="border-top: 1px solid #e2e8f0; padding-top: 6px; margin-top: 4px;">
                ${point.matched ? `
                    <div style="display: grid; grid-template-columns: auto 1fr; gap: 4px 12px;">
                        <span style="color:#64748b">Speed:</span> 
                        <strong>${Math.round(point.speed_kmph || 0)} km/h</strong>
                        
                        <span style="color:#64748b">Limit:</span> 
                        <span>${point.limit_applied || 'N/A'} km/h</span>
                        
                        <span style="color:#64748b">Status:</span> 
                        <strong style="color: ${point.status === 'violation' ? '#dc2626' : point.status === 'warning' ? '#d97706' : '#16a34a'}">
                            ${point.status.toUpperCase()}
                        </strong>
                    </div>
                    <div style="margin-top: 6px; font-size: 10px; color: #94a3b8;">
                        Time: ${point.logging_time?.split(' ')[1] || '-'}
                    </div>
                ` : `
                    <div style="color: #94a3b8; font-style: italic; padding: 4px 0;">
                        ${point.source === 'Signal' ? 'Signal location' : 'No matching train data found'}
                    </div>
                `}
            </div>
          </div>
        `
        marker.bindPopup(popupContent)
      })

      // --- 5. Legend ---
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
        
        const item = (color: string, label: string, shape: string = '50%') => `
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 2px;">
                <div style="width: 10px; height: 10px; background: ${color}; border-radius: ${shape}; border: 1px solid #cbd5e1;"></div>
                <span style="color: #334155;">${label}</span>
            </div>
        `
        
        div.innerHTML = `
            <strong style="display:block; margin-bottom:4px; color:#0f172a;">Legend</strong>
            ${item('#ef4444', 'Violation', '50%')}
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 2px;">
                <div style="width: 10px; height: 14px; background: #1f2937; border-radius: 2px; border: 1px solid white; position: relative;">
                    <div style="width:4px; height:4px; background:#22c55e; border-radius:50%; margin: 8px auto 0 auto;"></div>
                </div>
                <span style="color: #334155;">Signal</span>
            </div>
            ${item('#16a34a', 'Matched OHE', '50%')}
            ${item('#94a3b8', 'Unmatched OHE', '50%')}
        `
        return div
      }
      legend.addTo(map)

      // Fit map
      if (allPoints.length > 0 && bounds.isValid()) {
        map.fitBounds(bounds, { padding: [50, 50] })
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
