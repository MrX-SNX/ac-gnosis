import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { ethers } from 'ethers';
import WalletConnect from '@walletconnect/client';
import { IClientMeta, IWalletConnectSession } from '@walletconnect/types';
import { useSafeAppsSDK } from '@gnosis.pm/safe-apps-react-sdk';
import { SafeAppProvider } from '@gnosis.pm/safe-apps-provider';
import { getSafe } from '../utils/safe';
import { useWeb3Context } from '../web3.context';

const rejectWithMessage = (
  connector: WalletConnect,
  id: number | undefined,
  message: string
) => {
  connector.rejectRequest({ id, error: { message } });
};

const useWalletConnect = () => {
  const { signer } = useWeb3Context();
  const { safe, sdk } = useSafeAppsSDK();
  const [wcClientData, setWcClientData] = useState<IClientMeta | null>(null);
  const [connector, setConnector] = useState<WalletConnect | undefined>();
  const web3Provider = useMemo(
    () =>
      new ethers.providers.Web3Provider(new SafeAppProvider(safe, sdk as any)),
    [sdk, safe]
  );

  const localStorageSessionKey = useRef(`session_${safe.safeAddress}`);

  const wcDisconnect = useCallback(async () => {
    try {
      await connector?.killSession();
      setConnector(undefined);
      setWcClientData(null);
    } catch (error) {
      console.log('Error trying to close WC session: ', error);
    }
  }, [connector]);

  const wcConnect = useCallback(
    async ({
      uri,
      session,
    }: {
      uri?: string;
      session?: IWalletConnectSession;
    }) => {
      const wcConnector = new WalletConnect({
        uri,
        bridge: 'https://bridge.walletconnect.org',
        session,
      });
      setConnector(wcConnector);
      setWcClientData(wcConnector.peerMeta);
      wcConnector.on('session_request', (error, payload) => {
        if (error) {
          throw error;
        }
        getSafe(signer!).then((s) => {
          s.getChainId().then((chain) => {
            wcConnector.approveSession({
              accounts: [s.getAddress()],
              chainId: chain,
            });
            setWcClientData(payload.params[0].peerMeta);
          });
        });
      });

      wcConnector.on('call_request', async (error, payload) => {
        if (error) {
          throw error;
        }

        try {
          let result = await web3Provider.send(payload.method, payload.params);

          wcConnector.approveRequest({
            id: payload.id,
            result,
          });
        } catch (err) {
          rejectWithMessage(wcConnector, payload.id, (err as Error).message);
        }
      });

      wcConnector.on('disconnect', (error) => {
        if (error) {
          throw error;
        }
        wcDisconnect();
      });
    },
    [safe, wcDisconnect, web3Provider, signer]
  );

  useEffect(() => {
    if (!connector) {
      const session = localStorage.getItem(localStorageSessionKey.current);
      if (session) {
        wcConnect({ session: JSON.parse(session) });
      }
    }
  }, [connector, wcConnect]);

  return { wcClientData, wcConnect, wcDisconnect };
};

export default useWalletConnect;