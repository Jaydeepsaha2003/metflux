// Interactive India + World maps for the "Where We Reach" section.
// Built with react-simple-maps so the geometry is real SVG — no PDF crops.
//
// Map data lives in /public/maps/ so it ships with the static export
// and works without any network call at runtime.
import React, { useState } from 'react';
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
  ZoomableGroup,
} from 'react-simple-maps';

type LatLng = [number, number]; // [longitude, latitude] — d3 convention

/* Anchor describes which side of the marker the label sits on, so we can
   keep label text away from the dot without overlapping nearby markers. */
type Anchor = 'left' | 'right' | 'top' | 'bottom';

/* ── India — major-city markers per region. ── */
const INDIA_MARKERS: { name: string; coords: LatLng; anchor?: Anchor }[] = [
  { name: 'Delhi',         coords: [77.21, 28.61], anchor: 'top'    },
  { name: 'Chandigarh',    coords: [76.78, 30.73], anchor: 'left'   },
  { name: 'Dehradun',      coords: [78.03, 30.32], anchor: 'right'  },
  { name: 'Jaipur',        coords: [75.79, 26.92], anchor: 'left'   },
  { name: 'Lucknow',       coords: [80.95, 26.85], anchor: 'right'  },
  { name: 'Patna',         coords: [85.14, 25.61], anchor: 'right'  },
  { name: 'Guwahati',      coords: [91.74, 26.14], anchor: 'right'  },
  { name: 'Bhopal',        coords: [77.41, 23.26], anchor: 'left'   },
  { name: 'Ranchi',        coords: [85.31, 23.34], anchor: 'right'  },
  { name: 'Kolkata',       coords: [88.36, 22.57], anchor: 'right'  },
  { name: 'Vadodara (HQ)', coords: [73.18, 22.31], anchor: 'left'   },
  { name: 'Bhubaneswar',   coords: [85.82, 20.30], anchor: 'right'  },
  { name: 'Mumbai',        coords: [72.87, 19.07], anchor: 'left'   },
  { name: 'Hyderabad',     coords: [78.48, 17.38], anchor: 'left'   },
  { name: 'Visakhapatnam', coords: [83.22, 17.69], anchor: 'right'  },
  { name: 'Bengaluru',     coords: [77.59, 12.97], anchor: 'left'   },
  { name: 'Chennai',       coords: [80.27, 13.08], anchor: 'right'  },
  { name: 'Kochi',         coords: [76.27,  9.93], anchor: 'bottom' },
];

/* ── World — export markets, anchored on a representative city. ── */
const WORLD_MARKERS: { name: string; coords: LatLng; anchor?: Anchor; highlight?: boolean }[] = [
  { name: 'Vadodara (HQ)', coords: [73.18, 22.31], anchor: 'bottom', highlight: true },
  { name: 'Dubai',         coords: [55.30, 25.27], anchor: 'left'   },
  { name: 'Riyadh',        coords: [46.68, 24.71], anchor: 'left'   },
  { name: 'Nairobi',       coords: [36.82, -1.29], anchor: 'bottom' },
  { name: 'Lagos',         coords: [ 3.38,  6.52], anchor: 'left'   },
  { name: 'Singapore',     coords: [103.82, 1.35], anchor: 'bottom' },
  { name: 'Bangkok',       coords: [100.50,13.76], anchor: 'right'  },
  { name: 'London',        coords: [-0.13, 51.50], anchor: 'top'    },
  { name: 'New York',      coords: [-74.0, 40.71], anchor: 'left'   },
];

/* Builds the {dx, dy, anchor} for an SVG <text> based on which side
   of the dot the label sits on. */
const labelOffset = (anchor: Anchor = 'right') => {
  switch (anchor) {
    case 'left':   return { dx: -10, dy:  3, textAnchor: 'end'    as const };
    case 'right':  return { dx:  10, dy:  3, textAnchor: 'start'  as const };
    case 'top':    return { dx:   0, dy: -8, textAnchor: 'middle' as const };
    case 'bottom': return { dx:   0, dy: 14, textAnchor: 'middle' as const };
  }
};

/* Shared label style — text + subtle white halo so it stays readable
   against the muted map fill. */
const labelClass =
  'pointer-events-none select-none fill-slate-800 text-[10px] font-medium';
const labelHaloStyle: React.CSSProperties = {
  paintOrder: 'stroke',
  stroke: 'rgba(255,255,255,0.85)',
  strokeWidth: 3,
  strokeLinejoin: 'round',
};

const ChipTooltip = ({ x, y, label }: { x: number; y: number; label: string }) =>
  label ? (
    <div
      className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-[11px] font-medium text-white shadow-md"
      style={{ left: x, top: y - 8 }}
    >
      {label}
    </div>
  ) : null;

/* ── India map ─────────────────────────────────────────────────── */
export const IndiaMap = () => {
  const [hover, setHover] = useState<{ x: number; y: number; label: string }>({
    x: 0, y: 0, label: '',
  });

  return (
    <div className="relative w-full">
      <ComposableMap
        projection="geoMercator"
        projectionConfig={{ scale: 950, center: [82, 23] }}
        width={800}
        height={520}
        style={{ width: '100%', height: 'auto' }}
      >
        <Geographies geography="/maps/india-states.geojson">
          {({ geographies }) =>
            geographies.map((geo) => (
              <Geography
                key={geo.rsmKey}
                geography={geo}
                fill="#e8effa"
                stroke="#94a3b8"
                strokeWidth={0.4}
                style={{
                  default: { outline: 'none' },
                  hover:   { fill: '#cfe0ff', outline: 'none' },
                  pressed: { outline: 'none' },
                }}
              />
            ))
          }
        </Geographies>
        {INDIA_MARKERS.map(({ name, coords, anchor }) => {
          const off = labelOffset(anchor);
          return (
            <Marker
              key={name}
              coordinates={coords}
              onMouseEnter={(e) => setHover({ x: e.clientX, y: e.clientY, label: name })}
              onMouseMove={(e) => setHover((h) => ({ ...h, x: e.clientX, y: e.clientY }))}
              onMouseLeave={() => setHover({ x: 0, y: 0, label: '' })}
            >
              <circle r={9} fill="#2cab4a" opacity={0.2} />
              <circle r={4.5} fill="#2cab4a" stroke="#fff" strokeWidth={1.5} />
              <text
                dx={off.dx}
                dy={off.dy}
                textAnchor={off.textAnchor}
                className={labelClass}
                style={labelHaloStyle}
              >
                {name}
              </text>
            </Marker>
          );
        })}
      </ComposableMap>
      <ChipTooltip {...hover} />
    </div>
  );
};

/* ── World map ─────────────────────────────────────────────────── */
export const WorldMap = () => {
  const [hover, setHover] = useState<{ x: number; y: number; label: string }>({
    x: 0, y: 0, label: '',
  });

  return (
    <div className="relative w-full">
      <ComposableMap
        projection="geoEqualEarth"
        width={800}
        height={420}
        style={{ width: '100%', height: 'auto' }}
      >
        <ZoomableGroup zoom={1} center={[20, 15]}>
          <Geographies geography="/maps/world-110m.json">
            {({ geographies }) =>
              geographies.map((geo) => {
                const isIndia = geo.properties?.name === 'India';
                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill={isIndia ? '#2cab4a' : '#e8effa'}
                    stroke="#94a3b8"
                    strokeWidth={0.4}
                    style={{
                      default: { outline: 'none' },
                      hover:   { fill: isIndia ? '#15803d' : '#cfe0ff', outline: 'none' },
                      pressed: { outline: 'none' },
                    }}
                  />
                );
              })
            }
          </Geographies>
          {WORLD_MARKERS.map(({ name, coords, anchor, highlight }) => {
            const off = labelOffset(anchor);
            return (
              <Marker
                key={name}
                coordinates={coords}
                onMouseEnter={(e) => setHover({ x: e.clientX, y: e.clientY, label: name })}
                onMouseMove={(e) => setHover((h) => ({ ...h, x: e.clientX, y: e.clientY }))}
                onMouseLeave={() => setHover({ x: 0, y: 0, label: '' })}
              >
                <circle r={highlight ? 12 : 8} fill="#2cab4a" opacity={0.18} />
                <circle
                  r={highlight ? 6 : 4}
                  fill={highlight ? '#15803d' : '#2cab4a'}
                  stroke="#fff"
                  strokeWidth={1.5}
                />
                <text
                  dx={off.dx}
                  dy={off.dy}
                  textAnchor={off.textAnchor}
                  className={
                    highlight
                      ? 'pointer-events-none select-none fill-emerald-800 text-[11px] font-bold'
                      : labelClass
                  }
                  style={labelHaloStyle}
                >
                  {name}
                </text>
              </Marker>
            );
          })}
        </ZoomableGroup>
      </ComposableMap>
      <ChipTooltip {...hover} />
    </div>
  );
};
