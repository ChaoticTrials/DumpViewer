import { useState, useEffect } from 'react';

function isLightTheme(theme: string | null): boolean {
  return theme === 'light' || theme === 'light-hc';
}

export const HeaderLogo = () => {
  const [light, setLight] = useState(() =>
    isLightTheme(document.documentElement.getAttribute('data-theme')),
  );

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setLight(isLightTheme(document.documentElement.getAttribute('data-theme')));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  return (
    <img src={light ? '/logoDark.svg' : '/logoLight.svg'} alt="Logo" style={{ height: '70%' }} />
  );
};
