import { css, cx } from '@emotion/css';
import { useRef, useState } from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';

import { GrafanaTheme2, StandardEditorProps } from '@grafana/data';
import {
  useStyles2,
} from '@grafana/ui';

import { Options } from './panelcfg.gen';

export const TextPanelEditor = ({ value, onChange, context }: StandardEditorProps<string, {}, Options>) => {
  const styles = useStyles2(getStyles);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [lastUrl, setLastUrl] = useState<string>(value);
  const mutationObserverRef = useRef<MutationObserver | undefined>(
    undefined
  );

  const injectLocationCallback = () => {
    const iframe = iframeRef.current;
    if (!iframe) { return; }

    if (mutationObserverRef.current) {
      console.log('DISCONNECTING');
      mutationObserverRef.current.disconnect();
      mutationObserverRef.current = undefined;
    }

    console.log('setup callback');
    mutationObserverRef.current = setupLocationChangeCallback(
      iframe,
      (iframe: HTMLIFrameElement) => {
        console.log('callback');
        if (typeof window === 'undefined') {
          return;
        }

        if (iframe.contentWindow) {
          const currentIFrameURL = iframe.contentWindow?.location?.href;
          console.log('Current URL 2:', currentIFrameURL);
          if (currentIFrameURL !== lastUrl) {
            setLastUrl(currentIFrameURL);
            onChange(currentIFrameURL);
            console.log('URL changed 2:', currentIFrameURL);
          }
        }
      });
  }

  console.log(mutationObserverRef?.current);
  // useEffect(() => {
  //   const checkUrl = () => {
  //     const iframe = iframeRef.current;
  //     if (iframe && iframe.contentWindow) {
  //       try {
  //         const currentUrl = iframe.contentWindow.location.href;
  //         if (currentUrl !== lastUrl) {
  //           setLastUrl(currentUrl);
  //           onChange(currentUrl);
  //           console.log('URL changed:', currentUrl);
  //         }
  //       } catch (e) {
  //         // Handle cross-origin errors silently
  //         console.debug('Cannot access iframe URL due to cross-origin restrictions');
  //       }
  //     }
  //   };
  //
  //   // Check URL every 500ms
  //   const intervalId = setInterval(checkUrl, 500);
  //
  //   // Also check on load
  //   const handleLoad = () => {
  //     checkUrl();
  //     injectLocationCallback();
  //   };
  //
  //   const iframe = iframeRef.current;
  //   if (iframe) {
  //     iframe.addEventListener('load', handleLoad);
  //   }
  //
  //   return () => {
  //     clearInterval(intervalId);
  //     if (iframe) {
  //       iframe.removeEventListener('load', handleLoad);
  //     }
  //   };
  // }, [onChange, lastUrl]);
  const onLoad = (event: React.SyntheticEvent<HTMLIFrameElement>) => {
    console.log('ASDASDASD ON LOAD');
    injectLocationCallback();
  };

  return (
    <div className={cx(styles.editorBox)}>
      <AutoSizer disableHeight>
        {({ width }) => {
          if (width === 0) {
            return null;
          }
          return (
            <iframe
              id={"OodleLogs"}
              key={value}
              title="OodleLogs"
              allow="clipboard-read; clipboard-write"
              ref={iframeRef}
              width="100%"
              height="100%"
              src={value}
              className={styles.markdown}
              data-testid="TextPanel-converted-content"
              onLoad={onLoad}
            />
          );
        }}
      </AutoSizer>
    </div>
  );
};

const getStyles = (theme: GrafanaTheme2) => ({
  editorBox: css`
    label: editorBox;
    border: 1px solid ${theme.colors.border.medium};
    border-radius: ${theme.shape.radius.default};
    margin: ${theme.spacing(0.5)} 0;
    width: 100%;
  `,
  markdown: cx(
    'markdown-html',
    css`
      height: 100%;
    `
  ),
});
function setupLocationChangeCallback(
  iframe: HTMLIFrameElement,
  locationChangeCallback: (iframe: HTMLIFrameElement) => void
): MutationObserver | undefined {
  const doc = iframe.contentDocument;
  const location = iframe.contentDocument?.location;
  if (!doc || !location) {
    console.log('EARLY EXIT');
    return undefined;
  }

  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    const url = location.href;
    console.log('CALLBACK 2', url);
    console.log(iframe);
    if (url !== lastUrl) {
      locationChangeCallback(iframe);
      lastUrl = url;
    }
  });
  observer.observe(doc, { subtree: true, childList: true });
  return observer;
}
