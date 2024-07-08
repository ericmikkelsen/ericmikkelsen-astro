---
title: "Just right line height"
date: 2021-09-15
---

Line height is the extra space above and below your text. It creates extra space between lines of text. You may have heard it being called leading.

Here are some examples of different line-heights.

![This line-height is one hundred and fifty percent of the font size](/images/line-height-one-hundred-fifty-percent.svg)

The text above has more space between lines. While the text below has less space between lines. More line-height means more space as you can see in the examples above and below.

![This line-height is one hundred percent of the font size](/images/line-height-one-hundred-percent.svg)

## What is a good line height?

Web type expert Laura Franz says: 
> Smaller type tends to need more line height, not less. A generous line height helps the eye to recognize small word shapes more easily, and it encourages horizontal motion when the eye gets tired of reading small text.

[Balancing Line Length & Font Size In Responsive Web Design](https://www.smashingmagazine.com/2014/09/balancing-line-length-font-size-responsive-web-design/#line-height-and-font-size)

And the WCAG Guidline is:
> ... paragraph spacing is at least 1.5 times larger than the line spacing.

[Web Content Accessibility Guidelines for line height](https://www.w3.org/WAI/WCAG21/Understanding/visual-presentation.html#:~:text=Line%20spacing%20(leading)%20is%20at%20least%20space-and-a-half%20within%20paragraphs%2C%20and%20paragraph%20spacing%20is%20at%20least%201.5%20times%20larger%20than%20the%20line%20spacing.)

### I think good line height is ...

A good line-height for body copy is at least 150% of the font size, with more line height for smaller text, and less line height for larger text.

## Finding a line height that works anywhere.

There's usually logic and patterns to what designers create. As a developer it makes my life easier when I understand those patterns and logic. 

### Please forgive my math

A pattern I often see is 8px more than the font size used for a line height. For example, I'll often see body copy set at 16px, and the line height set at 24px, which is 150% of 16px like we mentioned above.

Here's my theory: 8px is the usually the extra space you want for a line height.

Here's some random numbers that I think look great for copy:

- Font size: 16px and line height: 24px is super common for body copy.
- Font size: 8px and line height: 16px is great for that tiny copyright notice in your footer that no one cares about.
- Font size: 32px and line height: 40px is fun for some big chunky headings.

For web developers, here's a simple way to standardize that extra 8px: 
```
line-height: calc(1em + .5rem);
```

The 1em above refers to 100% of the font-size of  your text. The .5rem refers to half of your html element's font size (which most people leave at or set at 16px). Now you can just do this once on your stylesheet and never set it again:

```
* {
  line-height: calc(1em + .5rem);
} 
```

### It gets awesome with fluid type.

I'm a big fan of fluid type, for example on my site I use the following for my heading level 2s.

```
* {
  line-height: calc(1em + .5rem);
}
h2 {
  font-size: clamp(1rem, calc(.875rem + 2vw), 3rem);
}
```

This way no matter how big or small my font size gets, the 8px extra maintains no matter what. On the smallest screens the when the font size is 16px the line height is 24px letting the font breathe, and on larger screens the line-height is 56px.

Sidenote: these numbers aren't totally true to what I'm doing on my site, since my html font size is also fluid and that makes it more complicated. I wanted to keep it simple. That said the same logic applies.

## Make it yours

Pending on what font you use on your site, you might pick a little less extra space like 6px or a little more like 9px. That's cool friend, you do you.

### Different fonts different line heights.
Or maybe you have 2 different fonts and each one needs a slightly different extra amount of space. You could probably do something cool with CSS variables like: 

```
html {
  font-size: 1rem;
}
* {
  line-height: calc( 1em + var(--line-height-extra, .5rem) );
}
.heading-font {
  --line-height-extra: .32rem;
  font-size: 2rem;
}
.body-font {
  --line-height-extra: .5rem;
  font-family: "Body Font" sans-serif;
}
```

For the .heading-font you're going to have 2.32rem for your line-height, and for the .body-font you're going to get 1.5rem;

I think just worrying about just the extra space makes more sense to me. But I'm most excited about fluid type sizes with consistent line-heights.