import { useState, useEffect } from 'react';
import { github, gml } from 'react-syntax-highlighter/dist/esm/styles/hljs';

const LIGHT_THEMES = ['light', 'light-hc'];

export function useHighlighterTheme() {
  const [isLight, setIsLight] = useState(() =>
    LIGHT_THEMES.includes(document.documentElement.getAttribute('data-theme') ?? 'dark'),
  );

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsLight(
        LIGHT_THEMES.includes(document.documentElement.getAttribute('data-theme') ?? 'dark'),
      );
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  return isLight ? github : gml;
}
