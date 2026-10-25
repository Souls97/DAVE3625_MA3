# Race Across Oslo

**Bike, public transport or walking? Race all three on your trip with live data and see which gets you there first.**

Race Across Oslo is a web app for deciding how to get across Oslo *right now*. Pick a start and a destination, and three racers set off on the map at the same time:

- 🚲 **Bike**: either an Oslo Bysykkel (walk to the nearest station that has bikes, ride, dock near the destination) or your own bike (door to door).
- 🚌 **Public transport**: the fastest real trip from Entur's journey planner, with live departures, waiting time and transfers.
- 🚶 **Walking**: the whole way on foot.

The race is animated on the map with a race clock, so you can see where each option is fast or slow, and the winner is announced at the end.

Demo: _add link here_ · Source: _add GitHub link here_

> School project for DAVE3625 (Artificial Intelligence) at OsloMet, Mandatory Assignment 3: "Vibe Coding". Not affiliated with Oslo Bysykkel, Entur or Ruter.

## Features

- **Live race on the map.** All three racers use live data: how many bikes and free docks each Bysykkel station has right now, and real-time public transport departures.
- **Your own speeds.** Set your walking and biking speed in km/h; every racer uses them.
- **Bysykkel or your own bike.** A switch picks between the city bike (with walking to and from stations, plus time to unlock and dock) and your own bike (door to door, plus a minute to get it out and a minute to lock it).
- **Icons that follow the trip.** Each racer's map icon shows what they are doing at that moment: 🚶 walking, ⏳ waiting, 🚌 🚋 🚇 🚆 ⛴️ riding public transport, 🔓 🚲 🔒 unlocking, biking and docking, 🏁 finished.
- **"When should I go?"** For a chosen day (today or the next six days), the app checks public transport every 30 minutes and draws a chart against the bike and walking times. A sentence sums it up, for example "The bike wins all day" or "Public transport beats the bike if you leave 07:30–09:00". The numbers are also available as a table.
- **Hover information on the map.** Zoom in and hover over a Bysykkel station to see bikes, e-bikes and free docks, or over a bus/tram/T-bane stop to see which lines stop there and the next live departures.
- **Address search**, "use my location", clicking the map to set start and destination, and swapping them.
- **Light and dark mode** that follow the system setting, including a matching map style where parks stay green.
- Works on phones (map on top, panel below).

## How it works

The app is a static website: plain HTML, CSS and JavaScript modules, with no build step and no backend. All data comes from open APIs that need no API key.

| Data | Source |
|---|---|
| Bysykkel stations, bikes and free docks | [Oslo Bysykkel open data](https://oslobysykkel.no/apne-data) (GBFS) |
| Public transport trips, walking and cycling routes, stops, departures | [Entur Journey Planner v3](https://developer.entur.org) (GraphQL) |
| Address search | Entur Geocoder |
| Map | [OpenFreeMap](https://openfreemap.org) vector tiles, © [OpenMapTiles](https://www.openmaptiles.org/), data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors |
| Map libraries | [Leaflet](https://leafletjs.com), [MapLibre GL](https://maplibre.org) |

The bike racer picks the nearest station with available bikes near the start and the nearest station with free docks near the destination. The walking parts use Entur's walking routes at your walking speed. The ride uses Entur's cycling route, but the ride time is calculated from the route length and your biking speed, because Entur's planner ignores the requested cycling speed.

| File | What it does |
|---|---|
| `index.html`, `css/style.css` | Page layout and styling |
| `js/app.js` | Map, search, results, race animation, day chart controls |
| `js/race.js` | Builds the three racers' trips |
| `js/day.js` | Checks public transport through a whole day |
| `js/chart.js` | Draws the "When should I go?" chart |
| `js/basemap.js` | Map colours for light and dark mode |
| `js/api.js` | Calls to Oslo Bysykkel and Entur |
| `js/logic.js` | Pure helper functions (distances, timelines, formatting) |
| `tests/` | Unit tests |

## Running it locally

You need Python 3 (for a simple web server) and Node.js 22 or newer (for the tests).

```sh
npm start   # serves the site at http://localhost:8000
npm test    # runs the unit tests
```

## How AI was used

The app was built with Claude Code (Anthropic's AI coding assistant) in the terminal. I described what I wanted in plain language, and the AI wrote, tested and changed the code, while I tried the app, gave feedback and decided what to build next. I committed each step to git myself.

The development went in rounds, roughly like this:

1. **Brainstorming.** I asked for creative ideas beyond the assignment's examples and chose a "bike vs. bus" race across Oslo.
2. **First version.** Live race between Bysykkel, public transport and walking, with address search and an animated map.
3. **Custom speeds.** Walking and biking speed in km/h, and a slower, less rushed animation.
4. **Simpler design.** The map and side panel felt cluttered, so the map was replaced by a calmer one and the panel was tidied up.
5. **"When should I go?" chart and hover information** for stations and stops.
6. **Map colours.** The grey map was too dull, so it was replaced by a map styled with the panel's colours where parks stay green, with a proper dark mode.
7. **Own bike option**, for more accurate times if you have your own bike.
8. **New English name** that describes what the app does.
9. **Live transport icons** on the racers during the race.

## Testing and improvements

- **Unit tests** (`npm test`) cover the logic that the race depends on: decoding Entur's route lines, distances, choosing stations, building and following timelines, picking the best public transport trip, the day-chart calculations, the map colours, and the own-bike racer (tested with a fake Entur so it runs offline).
- **Browser testing.** After each change the AI ran the app in a headless Chrome browser: it ran real races, hovered over the chart, stops and stations, checked the phone layout, looked for console errors and reviewed screenshots. I also tried each version myself.

Problems found and fixed along the way, among others:

- The first map provider started requiring an API key and showed a watermark, so the map was switched.
- The biking speed input was cut off in the side panel, and decimal speeds like 5.3 were rejected.
- About one in five public transport stops returned by Entur had no lines at all (for example stops closed for roadworks) and showed empty hover boxes; these are now hidden.
- "1 e-bikes" grammar, a chart label overlapping a number, and a chart tooltip covering the controls.
- Entur ignores the requested cycling speed, so the app calculates the ride time itself.

## Privacy

The app has no backend and stores nothing. Your location is only used if you click "use my location", and it is only sent to Entur to plan the trip. No API keys or passwords are used anywhere.
