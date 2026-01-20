# mapbox-clustering

Client-side marker clustering for Mapbox GL using [H3](https://h3geo.org/) hexagonal grid.

## Features

- **Collision-aware clustering** - Automatically adjusts cluster resolution based on your marker size to prevent overlapping
- **Viewport-optimized** - Only clusters points visible in the current map bounds
- **Customizable markers** - Full control over cluster HTML, styling, and behavior
- **Smart centering** - Intelligent cluster positioning that balances accuracy with collision avoidance
- **TypeScript** - Full type support with generics for your point data

## Installation

```bash
npm install mapbox-clustering
```

**Peer dependencies:** `mapbox-gl` (^3.16.0)

## Quick Start

```typescript
import mapboxgl from 'mapbox-gl';
import { addClusteredLayer } from 'mapbox-clustering';

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-3.7038, 40.4168],
  zoom: 5
});

const points = [
  { lat: 40.4168, lng: -3.7038 },
  { lat: 41.3874, lng: 2.1686 },
  { lat: 48.8566, lng: 2.3522 }
];

map.on('load', () => {
  const cleanup = addClusteredLayer(map, points, {
    clusterElementSize: 40,
    onClick: ({ zoomCluster }) => {
      zoomCluster({ padding: 80 });
    }
  });

  // Call cleanup() to remove clusters and event listeners
});
```

## How It Works

The library uses Uber's [H3 hexagonal grid system](https://h3geo.org/) to group nearby points into clusters. What makes it different:

**Collision-aware resolution**: Instead of using fixed zoom-to-resolution mappings, the library calculates the pixel size of H3 hexagons at the current zoom level and compares it to your `clusterElementSize`. It automatically selects the highest resolution (smallest hexagons) where markers won't overlap.

This means:
- Set `clusterElementSize` to match your marker's pixel diameter
- Markers will never visually collide at any zoom level
- Resolution adjusts dynamically as you zoom

## API

### `addClusteredLayer(map, data, options?)`

```typescript
const cleanup = addClusteredLayer<T>(map, data, options);
```

Returns a cleanup function that removes all markers and event listeners.

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `clusterElementSize` | `number` | `40` | Pixel size of cluster markers. Resolution auto-adjusts to prevent overlap. |
| `createMarker` | `function` | see below | Returns marker configuration for each cluster |
| `onClick` | `function` | - | Called when a cluster is clicked |
| `onMouseOver` | `function` | - | Called on mouse enter |
| `onMouseOut` | `function` | - | Called on mouse leave |
| `centeringStrategy` | `string` | `'smart'` | How to position cluster markers: `'centroid'`, `'cell-center'`, or `'smart'` |
| `omitClustering` | `boolean` | `false` | If true, each point becomes its own cluster |
| `throttle` | `number` | `200` | Minimum ms between recomputations during zoom |

### `createMarker(cluster)`

Control how each cluster renders:

```typescript
createMarker: (cluster) => ({
  content: `<div class="marker">${cluster.points.length}</div>`,
  class: 'my-marker-class',
  anchor: 'center',
  zIndex: 10,
  offsetX: 0,
  offsetY: 0
})
```

Return `undefined` or omit `content` to use Mapbox's default marker.

### `onClick({ cluster, zoomCluster, zoom })`

The `zoomCluster` helper fits the map to the cluster's points:

```typescript
onClick: ({ cluster, zoomCluster, zoom }) => {
  console.log(`Clicked cluster with ${cluster.points.length} points at zoom ${zoom}`);
  zoomCluster({ padding: 100, maxZoom: 15 });
}
```

## Types

```typescript
type LatLng = {
  lat: number;
  lng: number;
  weight?: number; // Optional weight for centroid calculation
};

type Cluster<T extends LatLng> = {
  id: string;
  center: LatLng;
  points: T[];
};
```

## Custom Point Data

Use generics to type your point data:

```typescript
type MyPoint = {
  lat: number;
  lng: number;
  id: string;
  name: string;
  category: string;
};

const points: MyPoint[] = [/* ... */];

addClusteredLayer<MyPoint>(map, points, {
  onClick: ({ cluster }) => {
    // cluster.points is MyPoint[]
    console.log(cluster.points.map(p => p.name));
  }
});
```

## Example with Custom Styling

```typescript
addClusteredLayer(map, points, {
  clusterElementSize: 48,
  createMarker: (cluster) => {
    if (cluster.points.length === 1) {
      return { content: '<div class="single-marker"></div>' };
    }
    return {
      content: `<div class="cluster-marker">${cluster.points.length}</div>`
    };
  },
  onClick: ({ zoomCluster }) => zoomCluster({ padding: 60 })
});
```

```css
.cluster-marker {
  width: 48px;
  height: 48px;
  background: #3b82f6;
  border: 2px solid white;
  border-radius: 50%;
  color: white;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.single-marker {
  width: 12px;
  height: 12px;
  background: #ef4444;
  border-radius: 50%;
  border: 2px solid white;
}
```

## Centering Strategies

| Strategy | Description |
|----------|-------------|
| `'smart'` (default) | Uses centroid for accuracy, blends toward cell center when neighboring cells have clusters to avoid collisions |
| `'centroid'` | Weighted average of all points in the cluster |
| `'cell-center'` | Center of the H3 hexagon cell |

## License

MIT
