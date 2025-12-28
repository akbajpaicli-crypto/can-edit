"use client"

import { useEffect, useRef } from "react"
import L from "leaflet"

// --- Types ---
interface MapPoint {
  location: string;
  latitude?: number;
  longitude?: number;
  lat?: number; // Handle variations
  lng?: number; // Handle variations
  speed_kmph?: number | null;
  limit_applied?: number | null;
  status?: 'ok' | 'warning' | 'violation';
  matched?: boolean;
  source?: string;
  logging_time?: string;
}

interface MapContainerProps {
  data?: MapPoint[]    
  signals?: MapPoint[] 
}

export function MapContainer({ data = [], signals = [] }: MapContainerProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<L.Map | null>(null)

  useEffect(() => {
    // 1. Safety Checks
    if (typeof window === "undefined" || !mapRef.current) return

    // 2. Normalize Data (Handle 'lat' vs 'latitude' and ensure valid arrays)
    const normalize = (items: any[], defaultSource: string) => {
        if (!Array.isArray(items)) return [];
        return items.map(p => ({
            ...p,
            // Coalesce coordinate keys
            latitude: Number(p.latitude ?? p.lat),
            longitude: Number(p.longitude ?? p.lng),
            source: p.source || defaultSource,
            status: p.status || 'ok'
        })).filter(p => 
            !isNaN(p.latitude) && 
            !isNaN(p.longitude) && 
            p.latitude !== 0 && 
            p.longitude !== 0
        );
    };

    const safePoints = [
        ...normalize(data, 'OHE'), 
        ...normalize(signals, 'Signal')
    ];

    const loadMap = async () => {
      // 3. Load Leaflet CSS/JS (Lazy)
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
      
      // 4. Initialize/Reset Map
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
      }

      const map = L.map(mapRef.current).setView([23.17, 79.94], 8) // Default Center (Jabalpur area approx)
      mapInstanceRef.current = map

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
      }).addTo(map)

      // --- Icons ---
      const createOheIcon = (color: string) => L.divIcon({
        html: `<div style="background-color: ${color}; width: 10px; height: 10px; border-radius: 50%; border: 1.5px solid white; box-shadow: 0 1px 3px rgba(0,0,0,0.5);"></div>`,
        className: "", iconSize: [10, 10], iconAnchor: [5, 5]
      })

      const signalIcon = L.divIcon({
        html: `
          <div style="position: relative; width: 24px; height: 24px; filter: drop-shadow(0 2px 2px rgba(0,0,0,0.5));">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2L12 22" stroke="#374151" stroke-width="2" stroke-linecap="round"/>
                <rect x="8" y="2" width="8" height="14" rx="2" fill="#1f2937" stroke="#9ca3af" stroke-width="1"/>
                <circle cx="12" cy="5" r="1.5" fill="#ef4444"/>
                <circle cx="12" cy="9" r="1.5" fill="#eab308"/>
                <circle cx="12" cy="13" r="1.5" fill="#22c55e"/>
            </svg>
          </div>`,
        className: "", iconSize: [24, 24], iconAnchor: [12, 24], popupAnchor: [0, -24]
      })

      const violationIcon = L.divIcon({
        html: `<div style="position: relative;">
            <div style="position: absolute; width: 16px; height: 16px; background-color: #ef4444; border-radius: 50%; animation: ping 1s infinite; opacity: 0.7;"></div>
            <div style="width: 12px; height: 12px; background-color: #dc2626; border-radius: 50%; border: 2px solid white;"></div>
        </div>
        <style>@keyframes ping { 75%, 100% { transform: scale(2); opacity: 0; } }</style>`,
        className: "", iconSize: [12, 12], iconAnchor: [6, 6]
      })

      // --- Plotting ---
      const bounds = L.latLngBounds([])
      let validCount = 0;

      safePoints.forEach((point) => {
        let icon;
        let zIndex = 100;

        if (point.status === 'violation') {
            icon = violationIcon;
            zIndex = 1000;
        } else if (point.source === 'Signal') {
            icon = signalIcon;
            zIndex = 500;
        } else if (point.matched) {
            icon = createOheIcon("#16a34a"); // Green
        } else {
            icon = createOheIcon("#94a3b8"); // Gray
        }

        L.marker([point.latitude!, point.longitude!], { icon, zIndexOffset: zIndex })
         .addTo(map)
         .bindPopup(`
            <div class="text-xs font-sans">
                <strong class="block mb-1">${point.location}</strong>
                <span class="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-semibold text-[10px]">${point.source}</span>
                ${point.speed_kmph ? `<div class="mt-2">Speed: <strong>${Math.round(point.speed_kmph)} km/h</strong></div>` : ''}
                ${point.limit_applied ? `<div>Limit: ${point.limit_applied} km/h</div>` : ''}
                ${point.logging_time ? `<div class="text-gray-400 mt-1">${point.logging_time.split(' ')[1]}</div>` : ''}
            </div>
         `);

        bounds.extend([point.latitude!, point.longitude!]);
        validCount++;
      })

      if (validCount > 0 && bounds.isValid()) {
        map.fitBounds(bounds, { padding: [50, 50] });
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
