// Plain-language text for beginner mode. Owner: GEO. No code knowledge needed. Just edit the strings.

export const explain = {
  sunTab: "This shows where sunlight comes from right now. On the Moon the Sun moves very slowly. One full day and night lasts about 29.5 Earth days.",
  shadowsTab: "Dark areas get no sunlight. At the poles the Sun stays low, so crater walls cast huge shadows. Some crater floors haven't seen sunlight in billions of years.",
  rimsTab: "Rims are the raised edges of craters. They stick up into the sunlight, so solar panels work there, and icy dark craters are close by. That's why we land on rims.",
  skyDome: "This is the sky above the landing site. The center is straight up and the edge is the horizon. ☀️ = Sun, 🌍 = Earth. If Earth is below the horizon, we can't talk to home directly.",
  crossSection: "Imagine slicing the ground like a cake and looking at it from the side. This is the height of the land along a line through the landing site.",
  score: "Green = good power and contact with Earth. Yellow = workable with care. Red = risky: long darkness, no Earth contact, or steep ground.",
  shadowsToHeights: "Shadows tell us heights. A taller hill makes a longer shadow. If we know how high the Sun is, we can work out how tall the hill is.",
  southPole:
    "This is the bottom of the Moon, seen from straight above. The black-floored craters are permanently shadowed: the Sun never reaches them, so they stay colder than −200 °C and can trap water ice. Landing sites sit on the sunny edges right next to them.",
  profile:
    "This is a side-on slice through the ground, like cutting a cake. Orange ground gets sunlight, blue ground is in shadow. Press ▶ to watch a whole lunar day (about 29.5 Earth days) go by. The bar underneath shows which spots got the most sun over that day. Turn the slice to point it toward the Sun and see the longest shadows.",
  // TODO(GEO): add text for split view, mission panel, timeline, resources, seasons
};

export const moonVsEarth = [
  { label: "Length of a day (sunrise to sunrise)", moon: "29.5 Earth days", earth: "24 hours" },
  { label: "Axis tilt", moon: "1.5°", earth: "23.4°" },
  { label: "Seasons", moon: "Almost none", earth: "Strong" },
  { label: "Atmosphere / weather", moon: "None", earth: "Yes" },
  { label: "Surface temperature", moon: "−170 °C to +120 °C (−240 °C in dark craters)", earth: "−50 °C to +50 °C (typical)" },
  // TODO(GEO): verify numbers, add gravity, distance, etc.
];
