'use client';

import { ReactNode, useEffect } from 'react';
import { MiniKit } from '@worldcoin/minikit-js';

export default function MiniKitProvider({ children }: { children: ReactNode }) {

  useEffect(() => {
    const init = async () => {
        if (!process.env.NEXT_PUBLIC_WORLD_ID_APP_ID) {
          throw new Error('NEXT_PUBLIC_WORLD_ID_APP_ID is required');
        }

        MiniKit.install(process.env.NEXT_PUBLIC_WORLD_ID_APP_ID);
    };

    init();
  }, []);

  return <>{children}</>;
}
