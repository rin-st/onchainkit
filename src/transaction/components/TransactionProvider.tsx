import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import type {
  Address,
  TransactionExecutionError,
  TransactionReceipt,
} from 'viem';
import type { ContractFunctionParameters } from 'viem';
import {
  useAccount,
  useConfig,
  useSwitchChain,
  useWaitForTransactionReceipt,
} from 'wagmi';
import { waitForTransactionReceipt } from 'wagmi/actions';
import { useValue } from '../../internal/hooks/useValue';
import {
  GENERIC_ERROR_MESSAGE,
  METHOD_NOT_SUPPORTED_ERROR_SUBSTRING,
  TRANSACTION_TYPE_CALLS,
  TRANSACTION_TYPE_CONTRACTS,
} from '../constants';
import { useCallsStatus } from '../hooks/useCallsStatus';
import { useSendCall } from '../hooks/useSendCall';
import { useSendCalls } from '../hooks/useSendCalls';
import { useTransactionStatus } from '../hooks/useTransactionStatus';
import { useTransactionType } from '../hooks/useTransactionType';
import { useWriteContract } from '../hooks/useWriteContract';
import { useWriteContracts } from '../hooks/useWriteContracts';
import type {
  LifeCycleStatus,
  CallsType,
  TransactionContextType,
  TransactionProviderReact,
} from '../types';

const emptyContext = {} as TransactionContextType;
export const TransactionContext =
  createContext<TransactionContextType>(emptyContext);

export function useTransactionContext() {
  const context = useContext(TransactionContext);
  if (context === emptyContext) {
    throw new Error(
      'useTransactionContext must be used within a Transaction component'
    );
  }
  return context;
}

export function TransactionProvider({
  address,
  capabilities,
  chainId,
  children,
  calls,
  contracts,
  onError,
  onStatus,
  onSuccess,
}: TransactionProviderReact) {
  // Core Hooks
  const account = useAccount();
  const config = useConfig();
  const [errorMessage, setErrorMessage] = useState('');
  const [isToastVisible, setIsToastVisible] = useState(false);
  const [lifeCycleStatus, setLifeCycleStatus] = useState<LifeCycleStatus>({
    statusName: 'init',
    statusData: null,
  }); // Component lifecycle
  const [receiptArray, setReceiptArray] = useState<TransactionReceipt[]>([]);
  const [transactionId, setTransactionId] = useState('');
  const [transactionHashArray, setTransactionHashArray] = useState<Address[]>(
    []
  );
  const { switchChainAsync } = useSwitchChain();

  /*
    useWriteContracts or useWriteContract
    Used for contract calls with an ABI and functions.
  */
  const { status: statusWriteContracts, writeContractsAsync } =
    useWriteContracts({
      setErrorMessage,
      setLifeCycleStatus,
      setTransactionId,
    });
  const {
    status: statusWriteContract,
    writeContractAsync,
    data: writeContractTransactionHash,
  } = useWriteContract({
    setErrorMessage,
    setLifeCycleStatus,
    setTransactionHashArray,
    transactionHashArray,
  });

  /*
    useSendCalls or useSendTransaction
    Used for contract calls with raw calldata.
  */
  const { status: statusSendCalls, sendCallsAsync } = useSendCalls({
    onError,
    setErrorMessage,
    setTransactionId,
  });
  const {
    status: statusSendCall,
    sendTransactionAsync,
    data: sendTransactionHash,
  } = useSendCall({
    onError,
    setErrorMessage,
    setTransactionHashArray,
    transactionHashArray,
  });

  /*
    Returns relevant information whether the transaction is using calldata or a contract call.
    Throws an error if both calls and contracts are defined.
    Throws an error if neither calls or contracts are defined.
  */
  const transactionType = useTransactionType({
    calls,
    contracts,
  });
  const { singleTransactionHash, statusBatched, statusSingle } =
    useTransactionStatus({
      transactionType,
      writeContractTransactionHash,
      statusWriteContracts,
      statusWriteContract,
      sendTransactionHash,
      statusSendCalls,
      statusSendCall,
    });

  const { transactionHash: batchedTransactionHash, status: callStatus } =
    useCallsStatus({
      setLifeCycleStatus,
      transactionId,
    });

  const { data: receipt } = useWaitForTransactionReceipt({
    hash: singleTransactionHash || batchedTransactionHash,
  });

  // Component lifecycle emitters
  useEffect(() => {
    // Emit Error
    if (lifeCycleStatus.statusName === 'error') {
      onError?.(lifeCycleStatus.statusData);
    }
    // Emit State
    onStatus?.(lifeCycleStatus);
  }, [
    onError,
    onStatus,
    lifeCycleStatus,
    lifeCycleStatus.statusData, // Keep statusData, so that the effect runs when it changes
    lifeCycleStatus.statusName, // Keep statusName, so that the effect runs when it changes
  ]);

  const getTransactionReceipts = useCallback(async () => {
    const receipts = [];
    for (const hash of transactionHashArray) {
      try {
        const txnReceipt = await waitForTransactionReceipt(config, {
          hash,
          chainId,
        });
        receipts.push(txnReceipt);
      } catch (err) {
        console.error('getTransactionReceiptsError', err);
        setErrorMessage(GENERIC_ERROR_MESSAGE);
      }
    }
    setReceiptArray(receipts);
  }, [chainId, config, transactionHashArray]);

  useEffect(() => {
    if (
      (transactionHashArray.length === contracts?.length &&
        contracts?.length > 1) ||
      (transactionHashArray.length === calls?.length && calls?.length > 1)
    ) {
      getTransactionReceipts();
    }
  }, [calls, contracts, getTransactionReceipts, transactionHashArray]);

  /*
    Execute a single transaction using EOA-friendly function calls.
    (either a call or a contract function)
  */
  const executeSingleTransaction = useCallback(
    async ({
      transaction,
      transactionType,
    }: {
      transaction: CallsType | ContractFunctionParameters;
      transactionType: string;
    }) => {
      if (transactionType === TRANSACTION_TYPE_CALLS) {
        await sendTransactionAsync?.(transaction as CallsType);
      }
      if (transactionType === TRANSACTION_TYPE_CONTRACTS) {
        await writeContractAsync?.(transaction as ContractFunctionParameters);
      }
    },
    [sendTransactionAsync, writeContractAsync]
  );

  /*
    Fallback to single transaction using EOA-friendly function calls.
    Called when the experimental hooks fail.
  */
  const fallbackToSingleTransaction = useCallback(async () => {
    try {
      for (const transaction of contracts || calls || []) {
        await executeSingleTransaction({ transaction, transactionType });
      }
    } catch (err) {
      // if user rejected request
      if (
        (err as TransactionExecutionError)?.cause?.name ===
        'UserRejectedRequestError'
      ) {
        setErrorMessage('Request denied.');
      } else {
        setErrorMessage(GENERIC_ERROR_MESSAGE);
      }
    }
  }, [calls, contracts, executeSingleTransaction, transactionType]);

  const switchChain = useCallback(
    async (targetChainId: number | undefined) => {
      if (targetChainId && account.chainId !== targetChainId) {
        await switchChainAsync({ chainId: targetChainId });
      }
    },
    [account.chainId, switchChainAsync]
  );

  /* 
    Execute batched transactions using the experimental hooks.
    Based off the transaction type (either contract functions or calls)
  */
  const executeBatchedTransactions = useCallback(async () => {
    if (transactionType === TRANSACTION_TYPE_CONTRACTS && contracts) {
      await writeContractsAsync({
        contracts,
        capabilities,
      });
    }
    if (transactionType === TRANSACTION_TYPE_CALLS && calls) {
      await sendCallsAsync({
        calls,
        capabilities,
      });
    }
  }, [
    writeContractsAsync,
    sendCallsAsync,
    calls,
    contracts,
    capabilities,
    transactionType,
  ]);

  const handleSubmitErrors = useCallback(
    async (err: unknown) => {
      // handles EOA error
      // (fallback to single transactions)
      if (
        err instanceof Error &&
        err.message.includes(METHOD_NOT_SUPPORTED_ERROR_SUBSTRING)
      ) {
        try {
          await fallbackToSingleTransaction();
        } catch (_err) {
          setErrorMessage(GENERIC_ERROR_MESSAGE);
        }
        // handles user rejected request error
      } else if (
        (err as TransactionExecutionError)?.cause?.name ===
        'UserRejectedRequestError'
      ) {
        setErrorMessage('Request denied.');
        // handles generic error
      } else {
        setErrorMessage(GENERIC_ERROR_MESSAGE);
      }
    },
    [fallbackToSingleTransaction]
  );

  const handleSubmit = useCallback(async () => {
    setErrorMessage('');
    setIsToastVisible(true);
    try {
      await switchChain(chainId);
      await executeBatchedTransactions();
    } catch (err) {
      await handleSubmitErrors(err);
    }
  }, [chainId, executeBatchedTransactions, handleSubmitErrors, switchChain]);

  useEffect(() => {
    if (receiptArray?.length) {
      onSuccess?.({ transactionReceipts: receiptArray });
    } else if (receipt) {
      onSuccess?.({ transactionReceipts: [receipt] });
    }
  }, [onSuccess, receipt, receiptArray]);

  const value = useValue({
    address,
    calls,
    chainId,
    contracts,
    errorMessage,
    hasPaymaster: !!capabilities?.paymasterService?.url,
    isLoading: callStatus === 'PENDING',
    isToastVisible,
    onSubmit: handleSubmit,
    receipt,
    setErrorMessage,
    setIsToastVisible,
    setLifeCycleStatus,
    setTransactionId,
    statusBatched,
    statusSingle,
    transactionId,
    transactionHash: batchedTransactionHash || singleTransactionHash,
  });
  return (
    <TransactionContext.Provider value={value}>
      {children}
    </TransactionContext.Provider>
  );
}
