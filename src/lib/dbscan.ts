/**
 * DBSCAN clustering (TypeScript)
 *
 * Density-Based Spatial Clustering of Applications with Noise
 *
 * Complexity: O(n^2) neighborhood search by default.
 * For large datasets consider spatial indexes (kd-tree, ball tree) to accelerate region queries.
 *
 * By convention, `minPts` counts the point itself (as in the original paper).
 */

export type DistanceFn<T> = (a: T, b: T) => number;

export interface DbscanOptions<T> {
	/** Neighborhood radius (ε). Points within this distance are neighbors. */
	eps: number;
	/** Minimum number of points (including the point itself) to form a dense region. */
	minPts: number;
	/** Accessor that converts each item into a numeric vector when using default distance. */
	vector: (item: T) => number[];
	coord: (item: T) => { lat: number; lng: number };
	/** Optional distance function. Defaults to Euclidean distance for numeric vectors. */
	distance?: DistanceFn<T>;
}

/** Default Euclidean distance for numeric vectors */
function euclidean(a: number[], b: number[]): number {
	let sum = 0;
	const n = Math.min(a.length, b.length);
	for (let i = 0; i < n; i++) {
		const d = a[i] - b[i];
		sum += d * d;
	}
	return Math.sqrt(sum);
}

/** Guard to build a distance function from T -> vector if needed */
function buildDistance<T>(opts: DbscanOptions<T>): DistanceFn<T> {
	if (opts.distance) return opts.distance;
	const toVec: (x: T) => number[] = opts.vector;
	return (a: T, b: T) => euclidean(toVec(a), toVec(b));
}

/**
 * Run DBSCAN clustering.
 * @param points Array of items to cluster.
 * @param options DBSCAN parameters and optional distance configuration.
 * @returns Labels, clusters, noise indices, and core/border flags.
 */
export function dbscan<T>(points: T[], options: DbscanOptions<T>) {
	const { eps, minPts } = options;
	if (!(eps > 0)) throw new Error('eps must be > 0');
	if (!(minPts >= 1)) throw new Error('minPts must be >= 1');
	const n = points.length;
	const dist = buildDistance(options);

	const visited = new Uint8Array(n); // 0 = unvisited, 1 = visited
	const labels = new Array<number>(n).fill(-1); // -1 = noise, >=0 cluster id
	const corePoints = new Array<boolean>(n).fill(false);
	const borderPoints = new Array<boolean>(n).fill(false);

	// Precompute neighbor lists lazily to avoid O(n^2) upfront if early exit; cache for reuse
	const neighborsCache: (number[] | undefined)[] = new Array(n);

	const regionQuery = (i: number): number[] => {
		if (neighborsCache[i]) return neighborsCache[i]!;
		const res: number[] = [];
		const pi = points[i];
		for (let j = 0; j < n; j++) {
			if (i === j) {
				// include point itself to match minPts definition
				if (eps >= 0) res.push(j);
				continue;
			}
			if (dist(pi, points[j]) <= eps) res.push(j);
		}
		neighborsCache[i] = res;
		return res;
	};

	const clusters: number[][] = [];
	let clusterId = 0;

	for (let i = 0; i < n; i++) {
		if (visited[i]) continue;
		visited[i] = 1;

		const neigh = regionQuery(i);
		if (neigh.length + 1 /*self*/ < minPts) {
			// Not enough density around i -> temporarily label as noise; may become border later
			labels[i] = -1;
		} else {
			// Start a new cluster and expand
			clusters[clusterId] = [];
			expandCluster(i, neigh, clusterId);
			clusterId++;
		}
	}

	// After expansion, any point with label >=0 and not core is border
	for (let i = 0; i < n; i++) {
		if (labels[i] >= 0 && !corePoints[i]) borderPoints[i] = true;
	}

	const noise: number[] = [];
	for (let i = 0; i < n; i++) if (labels[i] === -1) noise.push(i);

	return groupByCluster(points, labels).map((points, i) => {
		const latlng = { lat: 0, lng: 0 };

		for (const point of points) {
			const coord = options.coord(point);
			latlng.lat += coord.lat;
			latlng.lng += coord.lng;
		}
		latlng.lat /= points.length;
		latlng.lng /= points.length;

		return {
			id: `${i}`,
			center: latlng,
			points: points
		};
	});

	function expandCluster(seedIndex: number, seedNeighbors: number[], cid: number) {
		// Assign seed and mark as core
		labels[seedIndex] = cid;
		corePoints[seedIndex] = true;
		clusters[cid].push(seedIndex);

		// We'll grow a queue of neighbors to process
		const queue: number[] = seedNeighbors.slice();

		for (let q = 0; q < queue.length; q++) {
			const j = queue[q];
			if (!visited[j]) {
				visited[j] = 1;
				const jNeigh = regionQuery(j);
				if (jNeigh.length + 1 /*self*/ >= minPts) {
					// j is a core point; merge its neighbors
					corePoints[j] = true;
					// Append neighbors; avoid duplicates by pushing and letting later checks skip
					for (let k = 0; k < jNeigh.length; k++) {
						const nb = jNeigh[k];
						// Only append if not already in queue to keep queue shorter (optional optimization)
						if (!queueIncludes(queue, nb)) queue.push(nb);
					}
				}
			}
			// If j is not yet assigned to a cluster, assign it
			if (labels[j] === -1) {
				labels[j] = cid;
				clusters[cid].push(j);
			}
		}
	}
}

/** Cheap membership test for small arrays. For large queues, consider a Set. */
function queueIncludes(arr: number[], x: number): boolean {
	for (let i = 0; i < arr.length; i++) if (arr[i] === x) return true;
	return false;
}

// -----------------------------
// Convenience helpers
// -----------------------------

/**
 * Convert clustered labels into clusters of the original items.
 */
function groupByCluster<T>(items: T[], labels: number[]): T[][] {
	const map = new Map<number, T[]>();
	for (let i = 0; i < items.length; i++) {
		const lbl = labels[i];
		if (lbl < 0) continue;
		if (!map.has(lbl)) map.set(lbl, []);
		map.get(lbl)!.push(items[i]);
	}
	// Sort by cluster id for stable output
	return Array.from(map.entries())
		.sort((a, b) => a[0] - b[0])
		.map(([, arr]) => arr);
}
