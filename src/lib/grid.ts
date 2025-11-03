type GridOptions<T> = {
	cellSize: number;
	/** Accessor that converts each item into a numeric vector when using default distance. */
	vector: (item: T) => number[];
};
export const grid = <T extends { lat: number; lng: number }>(
	data: T[],
	options: GridOptions<T>
) => {
	const buckets = {} as Record<string, T[]>;
	for (const [i, point] of data.entries()) {
		const [x, y] = options.vector(point);
		const groupID = `${Math.floor(x / options.cellSize)};${Math.floor(y / options.cellSize)}`;
		buckets[groupID] ||= [];
		buckets[groupID].push(point);
	}

	return Object.entries(buckets).map(([id, points]) => {
		const latlng = { lat: 0, lng: 0 };

		for (const point of points) {
			latlng.lat += point.lat;
			latlng.lng += point.lng;
		}
		latlng.lat /= points.length;
		latlng.lng /= points.length;

		return {
			id: id,
			center: latlng,
			points: points
		};
	});
};
