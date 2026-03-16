import { useState, useEffect } from 'react';

function isLightTheme(theme: string | null): boolean {
  return theme === 'light' || theme === 'light-hc';
}

export const HeaderLogo = () => {
  const [light, setLight] = useState(() => isLightTheme(document.documentElement.getAttribute('data-theme')));

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
    <div style={{ height: 32, width: 32, flexShrink: 0 }}>
      <img src={light ? '/logoDark.svg' : '/logoLight.svg'} alt="Logo" style={{ height: '100%', width: '100%' }} />
    </div>
  );
};
