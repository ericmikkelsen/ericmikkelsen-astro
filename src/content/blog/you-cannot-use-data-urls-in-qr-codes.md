---
title: "TIL, Data URLs don't work in QR codes"
date: 2022-08-24
---

Occasionally I need to spend a whole day or 2 learning that I can't do a thing I thought was possible. 

I thought it'd be super neat to load a whole website in a qr code using [data URLs](https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/Data_URLs). You _can_ in fact put a site in a data URL, but you can't navigate to it without copy and pasting it into your URL bar. MDN states that towards the bottom of that link above:

> A number of security issues (for example, phishing) have been associated with data URLs, and navigating to them in the browser's top level. To mitigate such issues, top-level navigation to data: URLs is blocked in all modern browsers.

[MDN on security of top level Data URLs](https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/Data_URLs#security_issues:~:text=the%20URL%20represents.-,Security%20issues,-A%20number%20of)

That makes sense. There's a certain amount of accountability when you have a server hosting something.

Now I get why Nicholas Jitkoff made [bitty.site](https://about.bitty.site), which does a bunch of voodoo to compress a site into the URL. You still need to have had an internet connection at some point. But it's not a bad work around.

