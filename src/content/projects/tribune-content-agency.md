---
description: Tribune Content Agency's website was my first big project featuring a ton 1000s of posts, multiple custom post types, custom fields, custom taxonomies, and built using responsive design.
title: Tribune Content Agency's site
url: https://tribunecontentagency.com/
---

While I was at Tribune Publishing this was my first real big project. I got to build a massive site, that would hold tons of content, use several custom post types and custom taxonomies. There's stuff that's weird about how I handled stuff, but I think mostly the site still holds up from a development perspective.

## Stuff I'm still proud of to this day

I was obsessed with the critical rendering path, and to this day, it still to interactive in under 3 seconds on 3g. The one trick I did, which I still haven't done since (but will now that I remember), was break up the stylesheets into different media queries. This was a not super awesome authoring experience, but it did prevent render blocking from those styles. Reducing the blocking styles to a stylesheet that wasn't even 14kb.

Because this was an agency, and I was kind of left to myself I got to set any kind of development standards I wanted. So I used that power responsibly and tried to make sure the site worked well in Opera Mini. It's not perfect, but alot of the interactions have fallbacks that allow you to access the same content.

## What I'd Change or update

1. This was before I ever worked with a build step, at this point, I'd probably handle that media query trick with gulp or post css or something.
2. I didn't know much about Accessibilty back then, so I'd go back and audit the site for A11Y issues.

## The Technologies I used:

- CSS
- HTML
- Javascript
- PHP
- Wordpress