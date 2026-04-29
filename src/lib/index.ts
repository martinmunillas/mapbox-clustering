import mapbox from 'mapbox-gl';
import * as h3 from 'h3-js';

function hashObject(obj: any) {
	return JSON.stringify(obj, Object.keys(obj).sort());
}

const getHexagonPixelDiameter = (resolution: number, zoom: number, latitude: number): number => {
	const edgeLengthMeters = h3.getHexagonEdgeLengthAvg(resolution, 'm');
	// Hexagon "diameter" is approximately 2 * edge length * cos(30deg) ≈ 1.73 * edge
	const hexDiameterMeters = edgeLengthMeters * 1.732;

	// Convert meters to pixels at this zoom/latitude
	const earthCircumference = 40075016.686;
	const metersPerPixel =
		(earthCircumference * Math.cos((latitude * Math.PI) / 180)) / (256 * Math.pow(2, zoom));

	return hexDiameterMeters / metersPerPixel;
};

const getResolutionForZoom = (zoom: number, latitude: number, elementSizePx: number): number => {
	// Start from highest resolution and decrease until hexagons are bigger than elements
	for (let res = 15; res >= 0; res--) {
		const hexPixelSize = getHexagonPixelDiameter(res, zoom, latitude);
		if (hexPixelSize >= elementSizePx) {
			return res;
		}
	}
	return 0; // Fallback to largest hexagons
};

const h3Grid = {
	latLngToCell(lat: number, lng: number, level: number): string {
		return h3.latLngToCell(lat, lng, level);
	},
	cellToLatLng(id: string): [number, number] {
		return h3.cellToLatLng(id) as [number, number];
	},
	neighbors(id: string): string[] {
		// h3-js gridRing gives neighbors at ring distance 1
		return h3.gridRing(id, 1);
	}
};

const throttle = (fn: (...args: any[]) => void, minInterval: number) => {
	let lastTime = 0;
	let trailingTimer: ReturnType<typeof setTimeout> | null = null;
	return function (...args: any[]) {
		const now = Date.now();
		if (trailingTimer) {
			clearTimeout(trailingTimer);
			trailingTimer = null;
		}
		if (now - lastTime >= minInterval) {
			lastTime = now;
			fn(...args);
		} else {
			// Schedule a trailing call so the last invocation is never dropped
			trailingTimer = setTimeout(
				() => {
					lastTime = Date.now();
					trailingTimer = null;
					fn(...args);
				},
				minInterval - (now - lastTime)
			);
		}
	};
};

const debounce = (fn: (...args: any[]) => void, timeout: number) => {
	let timer: number;
	return (...args: any[]) => {
		clearTimeout(timer);
		timer = setTimeout(() => {
			fn(...args);
		}, timeout);
	};
};

/**
 * @param {string} html - HTML representing a single element.
 * @return {HTMLElement} - The parsed HTML element.
 */
const htmlToElement = (html: string): HTMLElement => {
	const template = document.createElement('template');
	template.innerHTML = html.trim();
	const node = template.content.firstChild;

	if (!node || node.nodeType !== Node.ELEMENT_NODE) {
		throw new Error('Provided HTML must represent a single HTML element.');
	}

	return node as HTMLElement;
};

const centroid = (...points: LatLng[]): LatLng => {
	const latlng = { lat: 0, lng: 0 };
	let total = 0;
	for (const point of points) {
		const weight = point.weight || 1;
		latlng.lat += point.lat * weight;
		latlng.lng += point.lng * weight;
		total += weight || 1;
	}
	latlng.lat /= total;
	latlng.lng /= total;

	return latlng;
};

export type LatLng = { lat: number; lng: number; weight?: number };
export type Cluster<T extends LatLng> = {
	id: string;
	center: LatLng;
	points: T[];
};

export type AddClusteredLayerOptions<T extends LatLng> = {
	/**
	 * Min number of milliseconds in between computation executions
	 * @default 200
	 */
	throttle?: number;
	/**
	 * Will create all clusters of 1 point
	 * @default false
	 */
	omitClustering?: boolean;
	/**
	 * The HTML to be rendered on each cluster.
	 */
	createMarker?: (cluster: Cluster<T>) =>
		| {
				content?: string;
				zIndex?: number;
				anchor?: mapboxgl.Anchor;
				class?: string;
				offsetY?: number;
				offsetX?: number;
		  }
		| undefined;
	/**
	 * It's called when the marker is clicked
	 * @param cluster
	 */
	onClick?: (params: {
		cluster: Cluster<T>;
		zoomCluster: (options: { padding: number | mapboxgl.PaddingOptions; maxZoom?: number }) => void;
		zoom: number;
		event: MouseEvent;
	}) => void;
	onMouseOver?: (params: { cluster: Cluster<T> }) => void;
	onMouseOut?: (params: { cluster: Cluster<T> }) => void;
	/**
	 * Defines how the center of multi-points clustera are calculated
	 * (1 point clusters will center to the lat-lng of that point)
	 * @default cell-center
	 */
	centeringStrategy?: 'centroid' | 'cell-center' | 'smart';
	/**
	 * The size of cluster elements in pixels.
	 * Resolution is automatically adjusted to prevent cluster elements from overlapping.
	 * @default 40
	 */
	clusterElementSize?: number;
	// /**
	//  * Which spatial index to use
	//  * @default 'h3'
	//  */
	// gridSystem?: GridSystemId;
};

const DEFAULT_OPTIONS: AddClusteredLayerOptions<LatLng> = {
	throttle: 200,
	createMarker: (d: Cluster<LatLng>) => ({
		content: d.points.length === 1 ? undefined : `<div class="cluster">${d.points.length}</div>`
	}),
	centeringStrategy: 'smart' as const,
	clusterElementSize: 40
};

export const addClusteredLayer = <T extends { lat: number; lng: number }>(
	map: mapboxgl.Map,
	data: T[],
	options: AddClusteredLayerOptions<T> = DEFAULT_OPTIONS
) => {
	options.createMarker ||= DEFAULT_OPTIONS.createMarker;
	options.throttle ||= DEFAULT_OPTIONS.throttle;
	options.centeringStrategy ||= DEFAULT_OPTIONS.centeringStrategy;
	options.clusterElementSize ??= DEFAULT_OPTIONS.clusterElementSize;
	const _options = options;

	let markers = new Map<string, mapboxgl.Marker>();

	const compute = (e?: { type: string; originalEvent?: MouseEvent }) => {
		if (e && e.type === 'zoom' && !e.originalEvent) {
			// if there is no original event, it was a programmatic zoom thus we don't recompute on zoom, only on moveend
			return;
		}
		const options = _options as Required<typeof _options>;

		if (!map) return;
		const zoom = map.getZoom();

		// At low zoom levels (especially globe projection), bounds calculations are unreliable.
		// Show all points below zoom 5.
		let filtered: T[];
		if (zoom < 5) {
			filtered = data;
		} else {
			// Compute unpadded bounds without mutating map state to avoid flicker
			const canvas = map.getCanvas();
			const p = map.getPadding();
			const padding = {
				top: p.top ?? 0,
				bottom: p.bottom ?? 0,
				left: p.left ?? 0,
				right: p.right ?? 0
			};
			const topLeft = map.unproject([padding.left, padding.top]);
			const topRight = map.unproject([canvas.clientWidth - padding.right, padding.top]);
			const bottomLeft = map.unproject([padding.left, canvas.clientHeight - padding.bottom]);
			const bottomRight = map.unproject([
				canvas.clientWidth - padding.right,
				canvas.clientHeight - padding.bottom
			]);
			const bounds = new mapbox.LngLatBounds()
				.extend(topLeft)
				.extend(topRight)
				.extend(bottomLeft)
				.extend(bottomRight);
			if (bounds.isEmpty()) return;
			filtered = data.filter((p) => bounds.contains(p));
		}
		const center = map.getCenter();

		const resolution = getResolutionForZoom(zoom, center.lat, options.clusterElementSize);

		const buckets = {} as Record<string, T[]>;
		if (options.omitClustering) {
			for (const [i, point] of filtered.entries()) {
				buckets[`${i}`] = [point];
			}
		} else {
			for (const point of filtered) {
				const cell = h3Grid.latLngToCell(point.lat, point.lng, resolution);
				buckets[cell] ||= [];
				buckets[cell].push(point);
			}
		}

		const clusters = Object.entries(buckets).map(([id, points]) => {
			let center = { lat: 0, lng: 0 };

			if (options.centeringStrategy === 'centroid') {
				center = centroid(...points);
			} else if (options.centeringStrategy === 'cell-center') {
				const [lat, lng] = h3Grid.cellToLatLng(id);
				center.lat = lat;
				center.lng = lng;
			} else {
				// smart is a mix of strategies to make the centers as accurate as possible while trying to avoid collissions
				if (points.length === 1) {
					center.lat = points[0].lat;
					center.lng = points[0].lng;
				} else {
					center = centroid(...points);

					const [lat, lng] = h3Grid.cellToLatLng(id);

					const ids = h3Grid.neighbors(id);
					const someNeighborHasClusters = ids.some((id) => buckets[id]);
					if (someNeighborHasClusters) {
						center = centroid(
							{ lat: center.lat, lng: center.lng, weight: 3 },
							{ lat, lng, weight: 1 }
						);
					}
				}
			}

			return {
				id,
				center,
				points
			};
		});

		const newMarkers = new Map<string, mapboxgl.Marker>();
		for (const cluster of clusters) {
			const markerOptions = options.createMarker?.(cluster);

			let element: HTMLElement | undefined = markerOptions?.content
				? htmlToElement(markerOptions.content)
				: undefined;
			if (element) {
				if (markerOptions?.zIndex) {
					element.style.zIndex = markerOptions.zIndex.toString();
				}
				if (markerOptions?.class) {
					element.classList.add(markerOptions?.class);
				}

				element.onclick = (e) => {
					type ZoomCluster = Parameters<
						NonNullable<AddClusteredLayerOptions<T>['onClick']>
					>[0]['zoomCluster'];

					const zoomCluster: ZoomCluster = (options: {
						padding: number | mapboxgl.PaddingOptions;
						maxZoom?: number;
					}) => {
						const bounds = new mapbox.LngLatBounds();
						for (const point of cluster.points) {
							bounds.extend(point);
						}
						map.fitBounds(bounds, {
							padding: options.padding,
							maxZoom: options.maxZoom ?? 14.5,
							duration: 500,
							linear: true
						});
					};

					options.onClick?.({ cluster, zoomCluster, zoom, event: e });
				};
				if (options.onMouseOver) {
					element.onmouseover = () => options.onMouseOver({ cluster });
				}
				if (options.onMouseOut) {
					element.onmouseout = () => options.onMouseOut({ cluster });
				}
			}

			const marker = new mapbox.Marker({
				element,
				anchor: markerOptions?.anchor,
				offset: [markerOptions?.offsetX || 0, markerOptions?.offsetY || 0]
			});

			marker.setLngLat(cluster.center);
			newMarkers.set(hashObject({ ...markerOptions, ...cluster.center }), marker);
		}

		for (const [key, oldMarker] of markers) {
			if (!newMarkers.has(key)) {
				oldMarker.remove();
			}
		}

		for (const [key, nextMarker] of newMarkers) {
			const oldMarker = markers.get(key);
			if (!oldMarker) {
				nextMarker.addTo(map);
			} else {
				newMarkers.set(key, oldMarker);
			}
		}

		markers = newMarkers;
	};

	const handleZoom = throttle(compute, options.throttle!);
	map.on('zoom', handleZoom);
	const handleMoveEnd = debounce(compute, 100);
	map.on('moveend', handleMoveEnd);
	compute();

	return () => {
		map.off('zoom', handleZoom);
		map.off('moveend', handleMoveEnd);
		for (const [_, marker] of markers) {
			marker.remove();
		}
	};
};
