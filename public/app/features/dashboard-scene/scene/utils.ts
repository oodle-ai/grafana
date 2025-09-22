import { startTransition, useCallback, useEffect, useState } from "react";
import { CancelActivationHandler, SceneObject, SceneObjectState, UseStateHookOptions } from "@grafana/scenes";

export function useDeferredSceneObjectState<TState extends SceneObjectState>(
    model: SceneObject<TState>,
    options?: UseStateHookOptions
  ): TState {
    const [_, setState] = useState<TState>(model.state);
    const stateAtFirstRender = model.state;
    const shouldActivateOrKeepAlive = options?.shouldActivateOrKeepAlive ?? false;

    const handleStateChange = useCallback((state: TState) => {
      startTransition(() => {
        setState(state);
      });
    }, []);
  
    useEffect(() => {
      let unactivate: CancelActivationHandler | undefined;
  
      if (shouldActivateOrKeepAlive) {
        unactivate = model.activate();
      }
  
      const s = model.subscribeToState(handleStateChange);
  
      // Re-render component if the state changed between first render and useEffect (mount)
      if (model.state !== stateAtFirstRender) {
        handleStateChange(model.state);
      }
  
      return () => {
        s.unsubscribe();
  
        if (unactivate) {
          unactivate();
        }
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [model, shouldActivateOrKeepAlive]);
  
    return model.state;
  }