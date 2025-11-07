<script lang="ts">
	import mapbox from 'mapbox-gl';
	import 'mapbox-gl/dist/mapbox-gl.css';

	import data from '../data/data.json';
	import { untrack } from 'svelte';
	import { addClusteredLayer } from '../lib';
	import { PUBLIC_MAPBOX_ACCESS_TOKEN } from '$env/static/public';

	let container: undefined | HTMLDivElement = $state();
	let map: undefined | mapboxgl.Map = $state();

	$effect(() => {
		mapbox.accessToken = PUBLIC_MAPBOX_ACCESS_TOKEN;

		container;
		untrack(() => {
			if (!container) return;

			map = new mapbox.Map({
				container,
				center: {
					lng: data[500].longitude,
					lat: data[500].latitude
				},
				zoom: 10
			});

			const d = data.slice(0, 10_000).map((d) => ({ lat: d.latitude, lng: d.longitude }));

			addClusteredLayer(map, d, {
				onClick: ({ cluster, zoomCluster }) => {
					zoomCluster({ padding: 200 });
				}
			});
		});
	});
</script>

<div bind:this={container}></div>

<style>
	div {
		width: 100%;
		height: 800px;
	}

	:global(.cluster) {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		background: rgba(0, 123, 255, 0.8);
		color: white;
		border-radius: 50%;
		font-weight: 600;
		font-size: 14px;
		border: 2px solid white;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
		transition: background-color 0.2s ease;
		cursor: pointer;

		&:hover {
			transform: scale(1.1);
			background: rgba(0, 123, 255, 1);
		}
	}
</style>
