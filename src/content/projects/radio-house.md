---
description: Radio House is a React app and statically generated site I built to start practicing React and have an easy way to play local MP3s.
title: Radio House
url: https://radio-house.app/
---

Every single time I take a trip on a plane I'm stuck doing a thing I despise. Use iTunes. And every time I have to wait 5 minutes for it to catalogue all the music I have on my machine. The christmas mixes I've made my mom between now and the last time I opened Itunes, the memes, the fart noises I send to my wife in emails. Everything. It's the worst. I just want Winamp basically. I want a simple thing I could open up and add some songs, and get rolling. And I wanted it in a browser, because I love the web. (And like, I'm a web developer)

## Goals

I still want to transition from working on marketing properties, to working on tools people use, so this was a chance to build an app instead of a brochure site. So my goals were:

### To Learn React.

At some point I became a marketing developer, which from my point of view seems light years away from front end developer, but when you talk to regular human being, they're like "So you make web stuff, but not that web stuff?" It actually seems reasonably close. So this is one of a few projects I'll be working on to cut my teeth on React and Webpack and PWAs etc.

### Statically render as much as possible.

Ok, sure I'm learning React, but as performance nothing takes up processing power like Javascript. So that meant I wanted first render to have as much legitimate content rendered. I settled on using Next.js to pre-render static React (or in my case Preact) and hosted it on Netlify.

## Stuff I want to change or build still.

 1. ~~The whole point is offline support, so a service worker at some point so it can work offline~~
 2. Remembering previous tracks added
 3. Album + Artist Views
 4. Stretch goal is see if I can use some WASM library to rip cds. Probably not though.

 ## The Technologies I used:

- CSS
- HTML
- Javascript
- JSX
- Next.js
- Netlify
- Preact
- React