import { grid } from './grid';
import mapbox from 'mapbox-gl';

let markers: mapboxgl.Marker[] = [];

const clearMarkers = () => {
	for (const marker of markers) {
		marker.remove();
	}
	markers = [];
};

const throttle = (fn: VoidFunction, minInterval: number) => {
	let lastTime = 0;
	return function () {
		const now = Date.now();
		if (now - lastTime >= minInterval) {
			lastTime = now;
			fn();
		}
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

const DEFAULT_THROTTLE = 200;
const DEFAULT_CLUSTER_HTML = (d: unknown[]) =>
	d.length === 1 ? undefined : `<div class="cluster">${d.length}</div>`;
const DEFAULT_OPTIONS = { throttle: DEFAULT_THROTTLE, clusterHTML: DEFAULT_CLUSTER_HTML };

export const addClusteredLayer = <T extends { lat: number; lng: number }>(
	map: mapboxgl.Map,
	data: T[],
	options: {
		/**
		 * Min number of milliseconds in between computation executions
		 * @default 200
		 */
		throttle?: number;
		/**
		 * The HTML to be rendered on each cluster.
		 */
		clusterHTML?: (leafs: T[]) => string | undefined;
	} = DEFAULT_OPTIONS
) => {
	options = { ...DEFAULT_OPTIONS, ...options };
	const compute = throttle(() => {
		if (!map) return;
		clearMarkers();
		const bounds = map.getBounds();
		if (!bounds) return;
		const filtered = data.filter((p, i) => bounds.contains(p));

		const vectorFunc = (p: (typeof data)[number]) => {
			if (!map) return [0, 0];
			const point = map.project(p);
			return [point.x, point.y];
		};

		const groups = grid(filtered, {
			cellSize: 150,
			vector: vectorFunc
		});

		for (const group of groups) {
			const html = options.clusterHTML?.(group.points);

			let element: HTMLElement | undefined = html ? htmlToElement(html) : undefined;

			const marker = new mapbox.Marker({
				element
			});
			marker.setLngLat(group.center);
			marker.addTo(map);
			markers.push(marker);
		}
	}, options.throttle || 0);

	map.on('zoom', compute);
	compute();

	return () => {
		map.off('zoom', compute);
	};
};
