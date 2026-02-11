/**
 * Library Alternatives Module
 *
 * Maps legacy libraries to modern React-compatible alternatives
 */

export interface LibraryAlternative {
  purpose: string;
  modern: string[];
  notes?: string;
}

export const LIBRARY_ALTERNATIVES: Record<string, LibraryAlternative> = {
  'jquery': {
    purpose: 'DOM manipulation and utilities',
    modern: ['vanilla-js', 'react-hooks'],
    notes: 'Most jQuery can be replaced with vanilla JS or React patterns',
  },

  'slick-carousel': {
    purpose: 'Carousel/slider component',
    modern: ['embla-carousel-react', 'swiper', 'keen-slider'],
    notes: 'embla-carousel is lightweight and React-first',
  },

  'swiper': {
    purpose: 'Touch slider/carousel',
    modern: ['swiper/react', 'embla-carousel-react'],
    notes: 'Swiper has official React support',
  },

  'gsap': {
    purpose: 'Animation library',
    modern: ['framer-motion', 'gsap (React-compatible)', '@react-spring/web'],
    notes: 'GSAP works in React, but framer-motion is more React-idiomatic',
  },

  'scrollmagic': {
    purpose: 'Scroll-triggered animations',
    modern: ['framer-motion (useScroll)', 'intersection-observer', 'react-intersection-observer'],
    notes: 'Intersection Observer API covers most ScrollMagic use cases',
  },

  'aos': {
    purpose: 'Animate on scroll',
    modern: ['framer-motion', 'react-intersection-observer'],
    notes: 'Simple CSS + Intersection Observer replaces AOS',
  },

  'bootstrap': {
    purpose: 'UI framework',
    modern: ['tailwindcss', 'shadcn/ui', 'radix-ui'],
    notes: 'Tailwind + headless UI components is the modern approach',
  },

  'lodash': {
    purpose: 'Utility functions',
    modern: ['es-toolkit', 'native-js', 'lodash-es (tree-shakeable)'],
    notes: 'Most lodash functions have native equivalents now',
  },

  'moment': {
    purpose: 'Date manipulation',
    modern: ['date-fns', 'dayjs', 'native Intl API'],
    notes: 'date-fns is tree-shakeable and lightweight',
  },

  'axios': {
    purpose: 'HTTP client',
    modern: ['fetch API', 'ky', 'ofetch'],
    notes: 'Native fetch is sufficient for most use cases',
  },

  'leaflet': {
    purpose: 'Interactive maps',
    modern: ['react-leaflet', 'mapbox-gl', 'react-map-gl'],
    notes: 'react-leaflet is the official React wrapper',
  },

  'masonry': {
    purpose: 'Masonry/grid layout',
    modern: ['CSS Grid', 'react-masonry-css', '@egjs/react-grid'],
    notes: 'CSS Grid with grid-auto-rows can achieve masonry in modern browsers',
  },

  'isotope': {
    purpose: 'Filtering/sorting layouts',
    modern: ['framer-motion (AnimatePresence)', 'react-flip-toolkit'],
    notes: 'React state + CSS Grid + animation library',
  },

  'lightbox': {
    purpose: 'Image lightbox/gallery',
    modern: ['yet-another-react-lightbox', 'photoswipe', 'react-image-lightbox'],
  },

  'magnific-popup': {
    purpose: 'Popup/modal/lightbox',
    modern: ['@radix-ui/react-dialog', 'headlessui', 'react-modal'],
    notes: 'Radix Dialog is accessible and unstyled',
  },

  'owl-carousel': {
    purpose: 'Carousel',
    modern: ['embla-carousel-react', 'swiper'],
  },

  'waypoints': {
    purpose: 'Scroll position detection',
    modern: ['intersection-observer', 'react-intersection-observer'],
  },

  'wow.js': {
    purpose: 'Reveal animations on scroll',
    modern: ['framer-motion', 'react-intersection-observer + CSS'],
  },

  'parallax.js': {
    purpose: 'Parallax effects',
    modern: ['framer-motion (useScroll + useTransform)', 'react-scroll-parallax'],
  },

  'typed.js': {
    purpose: 'Typing animation',
    modern: ['react-type-animation', 'typewriter-effect'],
  },

  'countup.js': {
    purpose: 'Number counting animation',
    modern: ['react-countup', 'framer-motion'],
  },

  'select2': {
    purpose: 'Enhanced select dropdowns',
    modern: ['@radix-ui/react-select', 'react-select', 'downshift'],
  },

  'datepicker': {
    purpose: 'Date picker',
    modern: ['react-day-picker', '@radix-ui/react-date-picker', 'react-datepicker'],
  },

  'fancybox': {
    purpose: 'Lightbox/gallery',
    modern: ['@fancyapps/ui', 'yet-another-react-lightbox'],
  },

  'velocity': {
    purpose: 'Animation',
    modern: ['framer-motion', 'react-spring'],
  },

  'animate.css': {
    purpose: 'CSS animations',
    modern: ['tailwindcss-animate', 'framer-motion', 'CSS @keyframes'],
    notes: 'Can still use animate.css, but Tailwind animate plugin is lighter',
  },

  'tether': {
    purpose: 'Positioning/tooltips',
    modern: ['@floating-ui/react', '@radix-ui/react-popover'],
  },

  'popper.js': {
    purpose: 'Tooltip/popover positioning',
    modern: ['@floating-ui/react'],
  },

  'chart.js': {
    purpose: 'Charts/graphs',
    modern: ['react-chartjs-2', 'recharts', 'visx', 'nivo'],
  },

  'datatables': {
    purpose: 'Data tables',
    modern: ['@tanstack/react-table', 'react-data-grid'],
  },

  'fullpage.js': {
    purpose: 'Full-page scroll sections',
    modern: ['@fullpage/react-fullpage', 'react-full-page'],
  },

  'scrollify': {
    purpose: 'Scroll snapping',
    modern: ['CSS scroll-snap', 'framer-motion'],
    notes: 'Native CSS scroll-snap is now well-supported',
  },

  'headroom.js': {
    purpose: 'Hide header on scroll',
    modern: ['react-headroom', 'custom hook + framer-motion'],
  },

  'sticky-kit': {
    purpose: 'Sticky elements',
    modern: ['CSS position: sticky'],
    notes: 'Native CSS sticky is well-supported now',
  },

  'imagesloaded': {
    purpose: 'Detect when images load',
    modern: ['native onLoad event', 'react-lazy-load-image-component'],
  },

  'lazysizes': {
    purpose: 'Lazy loading images',
    modern: ['native loading="lazy"', 'next/image'],
    notes: 'Native lazy loading and Next.js Image component handle this',
  },

  'picturefill': {
    purpose: 'Responsive images polyfill',
    modern: ['native <picture> element', 'next/image'],
    notes: 'No longer needed - browsers support <picture> natively',
  },

  'enquire.js': {
    purpose: 'Media query callbacks',
    modern: ['window.matchMedia', 'react-responsive', 'usehooks-ts useMediaQuery'],
    notes: 'Native matchMedia API is sufficient',
  },

  'modernizr': {
    purpose: 'Feature detection',
    modern: ['@supports CSS', 'native feature detection'],
    notes: 'Most features Modernizr detected are now universal',
  },
};

/**
 * Get modern alternatives for a library
 */
export function getAlternatives(libraryName: string): LibraryAlternative | null {
  const normalized = libraryName.toLowerCase().replace(/[@/]/g, '').split(/[^a-z0-9-]/)[0];
  return LIBRARY_ALTERNATIVES[normalized] || null;
}

/**
 * Get the recommended alternative (first in list)
 */
export function getRecommendedAlternative(libraryName: string): string | null {
  const alt = getAlternatives(libraryName);
  return alt?.modern[0] || null;
}
