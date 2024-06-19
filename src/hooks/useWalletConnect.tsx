import { useState, useEffect } from 'react';
import { useWeb3Context } from '../web3.context';
import { RpcRequest } from '../types/rpc';
import { Core } from '@walletconnect/core';
import { WcConnectProps } from '../components/WalletConnectField';
import { getSdkError } from '@walletconnect/utils';
import { Web3Wallet } from '@walletconnect/web3wallet';
import { Web3Wallet as Web3WalletType } from '@walletconnect/web3wallet/dist/types/client';

export const compatibleSafeMethods: string[] = [
  'eth_accounts',
  'net_version',
  'eth_chainId',
  'personal_sign',
  'eth_sign',
  'eth_signTypedData',
  'eth_signTypedData_v4',
  'eth_sendTransaction',
  'eth_blockNumber',
  'eth_getBalance',
  'eth_getCode',
  'eth_getTransactionCount',
  'eth_getStorageAt',
  'eth_getBlockByNumber',
  'eth_getBlockByHash',
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
  'eth_estimateGas',
  'eth_call',
  'eth_getLogs',
  'eth_gasPrice',
  'wallet_getPermissions',
  'wallet_requestPermissions',
  'safe_setSettings',
];

const EVMBasedNamespaces = 'eip155';

enum CONNECTION_STATUS {
  CONNECTED = 'CONNECTED',
  DISCONNECTED = 'DISCONNECTED',
}

const core = new Core({
  projectId: 'b8433306393b78ff75897e7f76f7d411',
});

const useWalletConnect = () => {
  const { signer, safe } = useWeb3Context();
  const [wallet, setWallet] = useState<Web3WalletType | undefined>(undefined);
  const [connectionStatus, setConnectionStatus] = useState<CONNECTION_STATUS>(CONNECTION_STATUS.DISCONNECTED);
  const [pendingRequest, setPendingRequest] = useState<RpcRequest | undefined>(undefined);
  const [activeTopic, setActiveTopic] = useState('');
  const [wcSession, setWcSession] = useState<any>();

  useEffect(() => {
    (async () => {
      const w = await Web3Wallet.init({
        core,
        metadata: {
          name: 'Ambassador Council',
          description: 'Safe integration for Ambassador Council',
          url: 'https://ambassador-council.web.app/',
          icons: [],
        },
      });
      console.info('wallet init');
      setWallet(w);
    })();
  }, []);

  useEffect(() => {
    if (wallet && wcSession) {
      wallet.on('session_request', async (params) => {
        switch (params.params.request.method) {
          case 'eth_sendTransaction': {
            setPendingRequest({
              id: params.id,
              jsonrpc: 'https://mainnet.optimism.io',
              method: params.params.request.method,
              params: params.params.request.params,
            });
            return;
          }
        }
      });
    }
  }, [wcSession, wallet]);

  useEffect(() => {
    if (wallet) {
      // we try to find a compatible active session
      const activeSessions = wallet.getActiveSessions();
      const compatibleSession = Object.keys(activeSessions)
        .map((topic) => activeSessions[topic])
        .find(
          (session) =>
            session?.namespaces[EVMBasedNamespaces]?.accounts[0] ===
            `${EVMBasedNamespaces}:10:0x46abFE1C972fCa43766d6aD70E1c1Df72F4Bb4d1`,
        );

      if (compatibleSession) {
        console.log('found session', compatibleSession);
        setWcSession(compatibleSession);
        setConnectionStatus(CONNECTION_STATUS.CONNECTED);
      }

      // events
      wallet.on('session_proposal', async (proposal) => {
        console.log(proposal);
        const { id, params } = proposal;
        const { requiredNamespaces } = params;

        // const fakeSafeAccountForL1 = `${EVMBasedNamespaces}:${1}:0x46abFE1C972fCa43766d6aD70E1c1Df72F4Bb4d1`;
        // const fakeSafeChain = `${EVMBasedNamespaces}:${1}`;
        const safeAccount = `${EVMBasedNamespaces}:${10}:0x46abFE1C972fCa43766d6aD70E1c1Df72F4Bb4d1`;
        const safeChain = `${EVMBasedNamespaces}:${10}`;
        // we accept all events like chainChanged & accountsChanged (even if they are not compatible with the Safe)
        const safeEvents = requiredNamespaces[EVMBasedNamespaces]?.events || [];

        try {
          const wcSession = await wallet.approveSession({
            id,
            namespaces: {
              eip155: {
                accounts: [safeAccount], // only the Safe account
                chains: [safeChain], // only the Safe chain
                methods: compatibleSafeMethods, // only the Safe methods
                events: safeEvents,
              },
              // 'eip155:1': {
              //   accounts: [fakeSafeAccountForL1], // only the Safe account
              //   chains: [fakeSafeChain], // only the Safe chain
              //   methods: compatibleSafeMethods, // only the Safe methods
              //   events: safeEvents,
              // },
            },
          });

          setWcSession(wcSession);
        } catch (error: any) {
          console.log('error: ', error);

          await wallet.rejectSession({
            id: proposal.id,
            reason: {
              code: 5100,
              message: 'wrong chain',
            },
          });
          setWcSession(undefined);
        }
      });
    }
  }, [wallet]);

  const approveRequest = (id?: number, hash?: string) => {
    console.log('approveRequest', id, hash, signer);
  };

  const rejectRequest = (id?: number, message?: string) => {
    setPendingRequest(undefined);
    console.log(wallet, id, message);
  };

  const wcDisconnect = async (topic?: string) => {
    if (topic) {
      try {
        await wallet?.core.pairing.disconnect({ topic });
      } catch (error) {
        console.error(error);
      }
    } else if (wcSession) {
      try {
        await wallet?.disconnectSession({
          topic: wcSession.topic,
          reason: {
            code: 5100,
            message: 'User disconnected. Safe Wallet Session ended by the user',
          },
        });
        setWcSession(undefined);
        console.log('here');
      } catch (error) {
        console.error(error);
        console.info('could not disconnect session', wcSession);
      }
    } else {
      const pairings = wallet?.core.pairing.getPairings();
      if (pairings && pairings[0]?.topic) {
        await Promise.all(
          pairings.map(async (pair) => {
            await wallet?.disconnectSession({ topic: pair.topic, reason: getSdkError('USER_REJECTED') });
            return await wallet?.core.pairing.disconnect({ topic: pair.topic });
          }),
        );
      }
    }

    setConnectionStatus(CONNECTION_STATUS.DISCONNECTED);
  };

  const wcConnect = async ({ uri }: WcConnectProps) => {
    if (uri && safe && wallet) {
      try {
        const { topic } = await wallet.core.pairing.pair({
          uri,
        });
        setActiveTopic(topic);
        setConnectionStatus(CONNECTION_STATUS.CONNECTED);
      } catch (error) {
        console.error('cant pair', JSON.stringify(error));
        await wcDisconnect();
      }
    }
  };

  const wcClientData = wallet?.metadata ?? undefined;

  return {
    wcClientData,
    wcConnect,
    wcDisconnect,
    connectionStatus,
    pendingRequest,
    approveRequest,
    rejectRequest,
    wallet,
    activeTopic,
    wcSession,
  };
};

export { useWalletConnect, CONNECTION_STATUS };
