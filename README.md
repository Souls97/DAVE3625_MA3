# Race Across Oslo

**Bike, public transport or walking? Race all three on your trip with live data and see which gets you there first.**

Pick a start and a destination in Oslo, and a bike (Bysykkel or your own), public transport and a walker race each other on the map, using live bike availability and real-time departures. A "When should I go?" chart shows how public transport compares through the day.

Demo: _add link here_

## How AI was used

This project was built with Claude Code. I started by asking it for app ideas, to see if anything interesting came up. A bike-vs-bus race caught my interest. From there I described what I wanted in plain language, tried each version myself and asked for changes when something felt off. The map was too cluttered at first, then too grey and boring, and the animation felt rushed. Some features came from just using the app, like wanting to race with my own bike instead of a Bysykkel. The AI wrote and tested the code, while I decided what to build and manually tested and commited any changes.

## Testing

Unit tests cover the race logic (`npm test`), and the AI tested each change in a headless browser with real races. Bugs found this way were fixed, for example empty info boxes for closed stops and a cut-off input field.

## Run it

```sh
npm start   # http://localhost:8000
```

Data from [Oslo Bysykkel](https://oslobysykkel.no/apne-data) and [Entur](https://developer.entur.org), map from [OpenFreeMap](https://openfreemap.org) / © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors. No API keys needed. School project for DAVE3625 at OsloMet, not affiliated with Oslo Bysykkel or Entur.
