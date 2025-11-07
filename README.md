# mapbox-clustering

Tiny, opinionated clustering helper for **Mapbox GL** that uses an H3 / S2-style grid under the hood to create **marker-based clusters** on the client.

You give it:

- a `mapboxgl.Map`
- an array of `{ lat, lng }` points

…and it gives you:

- computed clusters based on current **viewport bounds** & **zoom**
- automatic recomputation on zoom (throttled & debounced)
- full control over **cluster marker HTML** & **click/hover behavior**

---

## Features

- 🧮 Grid-based clustering using [H3](https://github.com/uber/h3-js) (S2 helpers are in the codebase and easy to wire in)
- 🗺 Cluster only what’s **visible in the map bounds**
- ♻️ Automatic recompute on `zoom` / `zoomend` with sensible throttling / debouncing
- 🎨 Fully customizable cluster markers via HTML
- 🧠 Smart cluster centering strategy (cell center + centroid blend)
- 🧊 Option to **omit clustering** and still reuse all event hooks

---

## Installation

```bash
npm install mapbox-clustering mapbox-gl
# or
yarn add mapbox-clustering mapbox-gl
# or
pnpm add mapbox-clustering mapbox-gl
```
You must already have a working Mapbox GL setup (access token, styles, etc.).

## Quick Start
```typescript
import mapboxgl from 'mapbox-gl';
import { addClusteredLayer, LatLng } from 'mapbox-clustering';

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/…',
  center: [-3.7038, 40.4168], // Madrid, for example
  zoom: 5,
});

const data: LatLng[] = [
  { lat: 40.4168, lng: -3.7038 },
  { lat: 41.3874, lng: 2.1686 },
  { lat: 48.8566, lng: 2.3522 },
  // ...
];

map.on('load', () => {
  const removeClusters = addClusteredLayer(map, data, {
    createMarker: (cluster) => ({
      content:
        cluster.points.length === 1
          ? undefined // default marker
          : `<div class="cluster">${cluster.points.length}</div>`,
    }),
    onClick: ({ cluster, zoomCluster, zoom }) => {
      console.log('Clicked cluster:', cluster, 'at zoom', zoom);

      // Example: zoom into the cluster
      zoomCluster({ padding: 80 });
    },
  });

  // later, to stop listening to zoom events:
  // removeClusters();
});
```
## API
`addClusteredLayer(map, data, options?)`
```typescript
export const addClusteredLayer = <T extends { lat: number; lng: number }>(
  map: mapboxgl.Map,
  data: T[],
  options?: AddClusteredLayerOptions<T>
): (() => void);
```

Returns a cleanup function that removes the zoom listeners:
```typescript
const dispose = addClusteredLayer(map, data, options);
// ...
dispose();
```
## Types
```typescript
export type LatLng = {
  lat: number;
  lng: number;
  weight?: number;
};

export type Cluster<T extends LatLng> = {
  id: string;
  center: LatLng;  // where the marker will be placed
  points: T[];     // original points in this cluster
};
```

## Options
```typescript
export type AddClusteredLayerOptions<
  T extends LatLng
> = {
  /**
   * Min number of milliseconds between cluster recomputations.
   * Applies to the zoom handler.
   * @default 200
   */
  throttle?: number;

  /**
   * If true, each point becomes its own "cluster".
   * You still get all the marker customisation and events.
   * @default false
   */
  omitClustering?: boolean;

  /**
   * How to render each cluster marker.
   * If `content` is undefined for a single-point cluster,
   * a default Mapbox Marker is used.
   */
  createMarker?: (cluster: Cluster<T>) =>
    | {
        content?: string;             // HTML string
        zIndex?: number;
        anchor?: mapboxgl.Anchor;
        class?: string;              // extra CSS class
        offsetY?: number;
        offsetX?: number;
      }
    | undefined;

  /**
   * Called when the cluster marker is clicked.
   */
  onClick?: (params: {
    cluster: Cluster<T>;
    zoomCluster: (options: {
      padding: number | mapboxgl.PaddingOptions;
    }) => void;
    zoom: number;
  }) => void;

  /**
   * Called when the mouse enters the cluster marker element.
   */
  onMouseOver?: (params: { cluster: Cluster<T> }) => void;

  /**
   * Called when the mouse leaves the cluster marker element.
   */
  onMouseOut?: (params: { cluster: Cluster<T> }) => void;

  /**
   * How to compute the center of multi-point clusters.
   * - 'centroid'    → geometric weighted centroid of points
   * - 'cell-center' → center of the underlying H3 cell
   * - 'smart'       → mix of both (default)
   * @default 'smart'
   */
  centeringStrategy?: 'centroid' | 'cell-center' | 'smart';
};
```

## Custom Marker Example
```typescript
addClusteredLayer(map, data, {
  createMarker: (cluster) => {
    const count = cluster.points.length;

    if (count === 1) {
      // Let Mapbox draw the default pin
      return;
    }

    return {
      content: `
        <div class="my-cluster">
          <span class="my-cluster__count">${count}</span>
        </div>
      `,
      class: 'my-cluster--big',
      offsetY: -10,
    };
  },
  onMouseOver: ({ cluster }) => {
    console.log('Hover cluster', cluster.id, cluster.points.length);
  },
});
```

Example CSS:
```css
.my-cluster {
  width: 32px;
  height: 32px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: white;
  border: 2px solid #222;
  font-size: 12px;
  font-weight: 600;
}

.my-cluster__count {
  pointer-events: none;
}
```
## Centering Strategy
`centeringStrategy` controls where the cluster marker is placed:
- 'centroid':

    Uses the (weighted) centroid of all points in the cluster.

- 'cell-center'
  
  Uses the center of the H3 cell that contains the points.

- 'smart' (default)
  
  Uses a mix of techniques to center the cluster as accurately as possible while trying to avoid collissions.

If you pass weight in your LatLng, it affects centroid computation.

## How Clustering Works (Internals)

- Uses an internal H3 grid implementation (h3-js) to:
  - Choose a grid resolution based on current zoom level.
  - Map each visible point into a cell id.
  - Group points by cell id → that’s your cluster.
- Clustering only considers points in the current map bounds
- Points outside the viewport are ignored until you pan/zoom them into view.
- Listeners:
  - `zoom` → throttled recompute (by options.throttle)
  - `zoomend` → debounced recompute

## Cleanup

`addClusteredLayer` returns a function that removes its zoom listeners:
```typescript
const remove = addClusteredLayer(map, data);
// ...
remove();
```

The markers are also replaced on every recomputation, so you don’t need to manage them manually.

## TypeScript

This library is written in TypeScript and ships its own types.
You can strongly type your point data:
```typescript
type MyPoint = LatLng & {
  id: string;
  name: string;
};

const points: MyPoint[] = [/* ... */];

addClusteredLayer<MyPoint>(map, points, {
  onClick: ({ cluster }) => {
    // cluster.points is MyPoint[]
    console.log(cluster.points[0].name);
  },
});
```
## Notes & Limitations

Currently the grid system is hard-wired to H3.
There is an internal S2 implementation that can be wired in if you need it.

All markers are managed globally inside the module; this utility is designed for one clustered layer per map instance. If you need multiple, you’ll want to adapt the implementation.