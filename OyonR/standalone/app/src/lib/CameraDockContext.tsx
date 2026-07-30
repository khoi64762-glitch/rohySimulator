import { createContext, useContext, type Dispatch, type ReactNode, type SetStateAction } from 'react';

/*
 * Camera-dock visibility belongs to the current app instance, not to the
 * browser. Persisting "closed" in localStorage made a dismiss action look
 * permanent on the next visit, and a global custom event made multiple
 * <oyon-app> instances affect one another. Keep it in AppShell state and make
 * that state available to the top bar and routed diagnostic tools.
 */

export interface CameraDockContextValue {
  visible: boolean;
  setVisible: Dispatch<SetStateAction<boolean>>;
}

const fallback: CameraDockContextValue = {
  visible: false,
  setVisible: () => undefined,
};

const CameraDockContext = createContext<CameraDockContextValue>(fallback);

export function CameraDockProvider({
  visible,
  setVisible,
  children,
}: CameraDockContextValue & { children: ReactNode }) {
  return (
    <CameraDockContext.Provider value={{ visible, setVisible }}>
      {children}
    </CameraDockContext.Provider>
  );
}

export function useCameraDock(): CameraDockContextValue {
  return useContext(CameraDockContext);
}
