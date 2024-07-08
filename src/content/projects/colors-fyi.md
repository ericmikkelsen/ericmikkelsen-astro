---
description: colors.fyi is a site that lists all the colors that are WCAG AA accessible with both black and white.
title: Colors.fyi
url: https://colors.fyi/
---

When I started at Boldium, one of the designers asked me if any colors worked with both black _and_ white, and I told them that you have #767676 and that's it. Then they spent a day with a color picker, and proved me wrong with a crazy vibrant orange. So I built [colors.fyi](https://colors.fyi/) as a list of all the colors that met the WCAG AA contrast requirements of 4.5 to 1, against both black and white.

## Goals

Aside form literally list 200,000+ hexcodes, I wanted to make this to work on any device, so I focused on making this work on Opera Mini, IE 8, and then the rest of the usual suspects (recent versions of Chrome, Edge, Firefox, Safari, etc).

## Future

At some point I'd love to add a feature for assembling a palette and exporting it to Figma, Illustrator, Tailwind, and other design and dev focused environments.

## Technology used

- [Eleventy](https://www.11ty.dev/)
- Node
- CSS,HTML