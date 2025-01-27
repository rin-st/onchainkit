import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import React, { act, useCallback, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, WagmiProvider, createConfig, useAccount } from 'wagmi';
import { base } from 'wagmi/chains';
import { mock } from 'wagmi/connectors';
import { buildSwapTransaction } from '../../api/buildSwapTransaction';
import { getSwapQuote } from '../../api/getSwapQuote';
import { DEGEN_TOKEN, ETH_TOKEN } from '../mocks';
import { getSwapErrorCode } from '../utils/getSwapErrorCode';
import { SwapProvider, useSwapContext } from './SwapProvider';

const mockResetFunction = vi.fn();
vi.mock('../hooks/useResetInputs', () => ({
  useResetInputs: () => useCallback(mockResetFunction, []),
}));

vi.mock('../../api/getSwapQuote', () => ({
  getSwapQuote: vi.fn(),
}));

vi.mock('../../api/buildSwapTransaction', () => ({
  buildSwapTransaction: vi
    .fn()
    .mockRejectedValue(new Error('buildSwapTransaction')),
}));

vi.mock('../utils/processSwapTransaction', () => ({
  processSwapTransaction: vi.fn(),
}));

vi.mock('wagmi', async (importOriginal) => {
  return {
    ...(await importOriginal<typeof import('wagmi')>()),
    useAccount: vi.fn(),
  };
});

const queryClient = new QueryClient();

const config = createConfig({
  chains: [base],
  connectors: [
    mock({
      accounts: [
        '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
        '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
      ],
    }),
  ],
  transports: {
    [base.id]: http(),
  },
});

const wrapper = ({ children }) => (
  <WagmiProvider config={config}>
    <QueryClientProvider client={queryClient}>
      <SwapProvider experimental={{ useAggregator: true, maxSlippage: 5 }}>
        {children}
      </SwapProvider>
    </QueryClientProvider>
  </WagmiProvider>
);

const renderWithProviders = ({
  Component,
  onError = vi.fn(),
  onStatus = vi.fn(),
  onSuccess = vi.fn(),
}) => {
  const mockExperimental = { useAggregator: true, maxSlippage: 10 };
  return render(
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <SwapProvider
          experimental={mockExperimental}
          onError={onError}
          onStatus={onStatus}
          onSuccess={onSuccess}
        >
          <Component />
        </SwapProvider>
      </QueryClientProvider>
    </WagmiProvider>,
  );
};

const TestSwapComponent = () => {
  const mockOnError = vi.fn();
  const mockOnSuccess = vi.fn();
  const context = useSwapContext();
  useEffect(() => {
    context.from.setToken(ETH_TOKEN);
    context.from.setAmount('100');
    context.to.setToken(DEGEN_TOKEN);
  }, [context]);
  const handleStatusError = async () => {
    context.setLifeCycleStatus({
      statusName: 'error',
      statusData: { code: 'code', error: 'error_long_messages', message: '' },
    });
  };
  const handleStatusAmountChange = async () => {
    context.setLifeCycleStatus({
      statusName: 'amountChange',
      statusData: {
        amountFrom: '',
        amountTo: '',
        isMissingRequiredField: false,
      },
    });
  };
  const handleStatusTransactionPending = async () => {
    context.setLifeCycleStatus({
      statusName: 'transactionPending',
      statusData: null,
    });
  };
  const handleStatusTransactionApproved = async () => {
    context.setLifeCycleStatus({
      statusName: 'transactionApproved',
      statusData: {
        transactionHash: '0x123',
        transactionType: 'ERC20',
      },
    });
  };
  const handleStatusSuccess = async () => {
    context.setLifeCycleStatus({
      statusName: 'success',
      statusData: { receipt: ['0x123'] },
    });
  };
  return (
    <div data-testid="test-component">
      <span data-testid="context-value-lifeCycleStatus-statusName">
        {context.lifeCycleStatus.statusName}
      </span>
      {context.lifeCycleStatus.statusName === 'error' && (
        <span data-testid="context-value-lifeCycleStatus-statusData-code">
          {context.lifeCycleStatus.statusData.code}
        </span>
      )}
      <button type="button" onClick={handleStatusError}>
        setLifeCycleStatus.error
      </button>
      <button type="button" onClick={handleStatusAmountChange}>
        setLifeCycleStatus.amountChange
      </button>
      <button type="button" onClick={handleStatusTransactionPending}>
        setLifeCycleStatus.transactionPending
      </button>
      <button type="button" onClick={handleStatusTransactionApproved}>
        setLifeCycleStatus.transactionApproved
      </button>
      <button type="button" onClick={handleStatusSuccess}>
        setLifeCycleStatus.success
      </button>
      <button
        type="submit"
        onClick={() => context.handleSubmit(mockOnError, mockOnSuccess)}
      >
        Swap
      </button>
    </div>
  );
};

describe('useSwapContext', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    (useAccount as ReturnType<typeof vi.fn>).mockReturnValue({
      address: '0x123',
    });
    await act(async () => {
      renderWithProviders({ Component: () => null });
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should throw an error when used outside of SwapProvider', () => {
    const TestComponent = () => {
      useSwapContext();
      return null;
    };
    // Suppress console.error for this test to avoid noisy output
    const originalError = console.error;
    console.error = vi.fn();
    expect(() => {
      render(<TestComponent />);
    }).toThrow('useSwapContext must be used within a Swap component');
    // Restore console.error
    console.error = originalError;
  });

  it('should provide context when used within SwapProvider', async () => {
    const TestComponent = () => {
      const context = useSwapContext();
      expect(context).toBeDefined();
      expect(context.from).toBeDefined();
      expect(context.to).toBeDefined();
      expect(context.handleAmountChange).toBeDefined();
      return null;
    };
    await act(async () => {
      renderWithProviders({ Component: TestComponent });
    });
  });
});

describe('SwapProvider', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    (useAccount as ReturnType<typeof vi.fn>).mockReturnValue({
      address: '0x123',
    });
  });

  it('should call setError when setLifeCycleStatus is called with error', async () => {
    const { result } = renderHook(() => useSwapContext(), { wrapper });
    const errorStatusData = {
      code: 'code',
      error: 'error_long_messages',
      message: 'test',
    };
    await act(async () => {
      result.current.setLifeCycleStatus({
        statusName: 'error',
        statusData: errorStatusData,
      });
    });
    expect(result.current.error).toBe(errorStatusData);
  });

  it('should call setError with undefined when setLifeCycleStatus is called with success', async () => {
    const { result } = renderHook(() => useSwapContext(), { wrapper });
    await act(async () => {
      result.current.setLifeCycleStatus({
        statusName: 'success',
        statusData: { receipt: ['0x123'] },
      });
    });
    expect(result.current.error).toBeUndefined();
  });

  it('should reset inputs when setLifeCycleStatus is called with success', async () => {
    const { result } = renderHook(() => useSwapContext(), { wrapper });
    await act(async () => {
      result.current.setLifeCycleStatus({
        statusName: 'success',
        statusData: { transactionReceipt: '0x123' },
      });
    });
    await waitFor(() => {
      expect(mockResetFunction).toHaveBeenCalled();
    });
    expect(mockResetFunction).toHaveBeenCalledTimes(1);
  });

  it('should emit onError when setLifeCycleStatus is called with error', async () => {
    const onErrorMock = vi.fn();
    renderWithProviders({ Component: TestSwapComponent, onError: onErrorMock });
    const button = screen.getByText('setLifeCycleStatus.error');
    fireEvent.click(button);
    expect(onErrorMock).toHaveBeenCalled();
  });

  it('should emit onStatus when setLifeCycleStatus is called with amountChange', async () => {
    const onStatusMock = vi.fn();
    renderWithProviders({
      Component: TestSwapComponent,
      onStatus: onStatusMock,
    });
    const button = screen.getByText('setLifeCycleStatus.amountChange');
    fireEvent.click(button);
    expect(onStatusMock).toHaveBeenCalled();
  });

  it('should update lifecycle status correctly after fetching quote for to token', async () => {
    vi.mocked(getSwapQuote).mockResolvedValueOnce({
      toAmount: '10',
      to: {
        decimals: 10,
      },
    });
    const { result } = renderHook(() => useSwapContext(), { wrapper });
    await act(async () => {
      result.current.handleAmountChange('from', '10', ETH_TOKEN, DEGEN_TOKEN);
    });
    expect(result.current.lifeCycleStatus).toStrictEqual({
      statusName: 'amountChange',
      statusData: {
        amountFrom: '10',
        amountTo: '1e-9',
        isMissingRequiredField: false,
        tokenFrom: {
          address: '',
          name: 'ETH',
          symbol: 'ETH',
          chainId: 8453,
          decimals: 18,
          image:
            'https://wallet-api-production.s3.amazonaws.com/uploads/tokens/eth_288.png',
        },
        tokenTo: {
          address: '0x4ed4e862860bed51a9570b96d89af5e1b0efefed',
          name: 'DEGEN',
          symbol: 'DEGEN',
          chainId: 8453,
          decimals: 18,
          image:
            'https://d3r81g40ycuhqg.cloudfront.net/wallet/wais/3b/bf/3bbf118b5e6dc2f9e7fc607a6e7526647b4ba8f0bea87125f971446d57b296d2-MDNmNjY0MmEtNGFiZi00N2I0LWIwMTItMDUyMzg2ZDZhMWNm',
        },
      },
    });
  });

  it('should update lifecycle status correctly after fetching quote for from token', async () => {
    vi.mocked(getSwapQuote).mockResolvedValueOnce({
      toAmount: '10',
      to: {
        decimals: 10,
      },
    });
    const { result } = renderHook(() => useSwapContext(), { wrapper });
    await act(async () => {
      result.current.handleAmountChange('to', '10', ETH_TOKEN, DEGEN_TOKEN);
    });
    expect(result.current.lifeCycleStatus).toStrictEqual({
      statusName: 'amountChange',
      statusData: {
        amountFrom: '1e-9',
        amountTo: '10',
        isMissingRequiredField: false,
        tokenTo: {
          address: '',
          name: 'ETH',
          symbol: 'ETH',
          chainId: 8453,
          decimals: 18,
          image:
            'https://wallet-api-production.s3.amazonaws.com/uploads/tokens/eth_288.png',
        },
        tokenFrom: {
          address: '0x4ed4e862860bed51a9570b96d89af5e1b0efefed',
          name: 'DEGEN',
          symbol: 'DEGEN',
          chainId: 8453,
          decimals: 18,
          image:
            'https://d3r81g40ycuhqg.cloudfront.net/wallet/wais/3b/bf/3bbf118b5e6dc2f9e7fc607a6e7526647b4ba8f0bea87125f971446d57b296d2-MDNmNjY0MmEtNGFiZi00N2I0LWIwMTItMDUyMzg2ZDZhMWNm',
        },
      },
    });
  });

  it('should emit onStatus when setLifeCycleStatus is called with transactionPending', async () => {
    const onStatusMock = vi.fn();
    renderWithProviders({
      Component: TestSwapComponent,
      onStatus: onStatusMock,
    });
    const button = screen.getByText('setLifeCycleStatus.transactionPending');
    fireEvent.click(button);
    expect(onStatusMock).toHaveBeenCalled();
  });

  it('should emit onStatus when setLifeCycleStatus is called with transactionApproved', async () => {
    const onStatusMock = vi.fn();
    renderWithProviders({
      Component: TestSwapComponent,
      onStatus: onStatusMock,
    });
    const button = screen.getByText('setLifeCycleStatus.transactionApproved');
    fireEvent.click(button);
    expect(onStatusMock).toHaveBeenCalled();
  });

  it('should emit onSuccess when setLifeCycleStatus is called with success', async () => {
    const onSuccessMock = vi.fn();
    renderWithProviders({
      Component: TestSwapComponent,
      onSuccess: onSuccessMock,
    });
    const button = screen.getByText('setLifeCycleStatus.success');
    fireEvent.click(button);
    expect(onSuccessMock).toHaveBeenCalled();
  });

  it('should reset status to init when setLifeCycleStatus is called with success', async () => {
    const onStatusMock = vi.fn();
    renderWithProviders({
      Component: TestSwapComponent,
      onStatus: onStatusMock,
    });
    const button = screen.getByText('setLifeCycleStatus.success');
    fireEvent.click(button);
    expect(onStatusMock).toHaveBeenCalledWith({
      statusName: 'init',
      statusData: {
        isMissingRequiredField: false,
      },
    });
  });

  it('should emit onStatus when setLifeCycleStatus is called with error', async () => {
    const onStatusMock = vi.fn();
    renderWithProviders({
      Component: TestSwapComponent,
      onStatus: onStatusMock,
    });
    const button = screen.getByText('setLifeCycleStatus.error');
    fireEvent.click(button);
    expect(onStatusMock).toHaveBeenCalled();
  });

  it('should handle toggles', async () => {
    const TestComponent = () => {
      const { from, to, handleToggle } = useSwapContext();
      // biome-ignore lint: hello
      React.useEffect(() => {
        const initializeSwap = async () => {
          await act(async () => {
            from.setToken(ETH_TOKEN);
            to.setToken(DEGEN_TOKEN);
            handleToggle();
          });
        };
        initializeSwap();
        handleToggle();
      }, []);
      return null;
    };
    await act(async () => {
      renderWithProviders({ Component: TestComponent });
    });
  });

  it('should pass the correct slippage to getSwapQuote', async () => {
    const TestComponent = () => {
      const { handleAmountChange } = useSwapContext();
      // biome-ignore lint: hello
      React.useEffect(() => {
        const initializeSwap = () => {
          handleAmountChange('from', '100', ETH_TOKEN, DEGEN_TOKEN);
        };
        initializeSwap();
      }, []);
      return null;
    };
    await act(async () => {
      renderWithProviders({ Component: TestComponent });
    });
    expect(getSwapQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        maxSlippage: '10',
        amount: '100',
        amountReference: 'from',
        from: ETH_TOKEN,
        to: DEGEN_TOKEN,
        useAggregator: true,
      }),
    );
  });

  it('should pass the correct amountReference to getSwapQuote', async () => {
    const TestComponent = () => {
      const { handleAmountChange } = useSwapContext();
      // biome-ignore lint: hello
      React.useEffect(() => {
        const initializeSwap = () => {
          handleAmountChange('to', '100', ETH_TOKEN, DEGEN_TOKEN);
        };
        initializeSwap();
      }, []);
      return null;
    };
    await act(async () => {
      renderWithProviders({ Component: TestComponent });
    });
    expect(getSwapQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        maxSlippage: '10',
        amount: '100',
        amountReference: 'from',
        from: ETH_TOKEN,
        to: DEGEN_TOKEN,
        useAggregator: true,
      }),
    );
  });

  it('should handle undefined in input', async () => {
    const TestComponent = () => {
      const { handleAmountChange } = useSwapContext();
      // biome-ignore lint: hello
      React.useEffect(() => {
        const initializeSwap = () => {
          handleAmountChange('from', '100', undefined, undefined);
        };
        initializeSwap();
      }, []);
      return null;
    };
    await act(async () => {
      renderWithProviders({ Component: TestComponent });
    });
  });

  it('should initialize with empty values', () => {
    const { result } = renderHook(() => useSwapContext(), { wrapper });
    expect(result.current.from.token).toBeUndefined();
    expect(result.current.from.amount).toBe('');
    expect(result.current.to.token).toBeUndefined();
    expect(result.current.to.amount).toBe('');
  });

  it('should toggle tokens and amounts', async () => {
    const { result } = renderHook(() => useSwapContext(), { wrapper });
    await act(async () => {
      result.current.from.setToken(ETH_TOKEN);
      result.current.from.setAmount('10');
      result.current.to.setToken(DEGEN_TOKEN);
      result.current.to.setAmount('1000');
    });
    await act(async () => {
      result.current.handleToggle();
    });
    expect(result.current.from.token?.symbol).toBe('DEGEN');
    expect(result.current.from.amount).toBe('1000');
    expect(result.current.to.token?.symbol).toBe('ETH');
    expect(result.current.to.amount).toBe('10');
  });

  it('should handle submit with missing data', async () => {
    const { result } = renderHook(() => useSwapContext(), { wrapper });
    await act(async () => {
      result.current.handleSubmit();
    });
    expect(result.current.error).toBeUndefined();
    expect(result.current.loading).toBe(false);
  });

  it('should update amount and trigger quote', async () => {
    const { result } = renderHook(() => useSwapContext(), { wrapper });
    await act(async () => {
      result.current.handleAmountChange('from', '10', ETH_TOKEN, DEGEN_TOKEN);
    });
    expect(getSwapQuote).toHaveBeenCalled();
    expect(result.current.to.loading).toBe(false);
  });

  it('should handle empty amount input', async () => {
    const { result } = renderHook(() => useSwapContext(), { wrapper });
    await act(async () => {
      await result.current.handleAmountChange(
        'from',
        '',
        ETH_TOKEN,
        DEGEN_TOKEN,
      );
    });
    expect(result.current.to.amount).toBe('');
  });

  it('should handle zero amount input', async () => {
    const { result } = renderHook(() => useSwapContext(), { wrapper });
    await act(async () => {
      await result.current.handleAmountChange(
        'from',
        '0',
        ETH_TOKEN,
        DEGEN_TOKEN,
      );
    });
    expect(result.current.to.amount).toBe('');
  });

  it('should setLifeCycleStatus to error when getSwapQuote throws an error', async () => {
    const mockError = new Error('Test error');
    vi.mocked(getSwapQuote).mockRejectedValueOnce(mockError);
    const { result } = renderHook(() => useSwapContext(), { wrapper });
    await act(async () => {
      result.current.handleAmountChange('from', '10', ETH_TOKEN, DEGEN_TOKEN);
    });
    expect(result.current.lifeCycleStatus).toEqual({
      statusName: 'error',
      statusData: {
        code: 'TmSPc01',
        error: JSON.stringify(mockError),
        message: '',
      },
    });
  });

  it('should setLifeCycleStatus to error when getSwapQuote returns an error', async () => {
    vi.mocked(getSwapQuote).mockResolvedValueOnce({
      code: getSwapErrorCode('uncaught-quote'),
      error: 'Something went wrong',
      message: '',
    });
    const { result } = renderHook(() => useSwapContext(), { wrapper });
    await act(async () => {
      result.current.handleAmountChange('from', '10', ETH_TOKEN, DEGEN_TOKEN);
    });
    expect(result.current.lifeCycleStatus).toEqual({
      statusName: 'error',
      statusData: {
        code: 'UNCAUGHT_SWAP_QUOTE_ERROR',
        error: 'Something went wrong',
        message: '',
      },
    });
  });

  it('should handle submit correctly', async () => {
    await act(async () => {
      renderWithProviders({ Component: TestSwapComponent });
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Swap'));
    });
    expect(buildSwapTransaction).toBeCalledTimes(1);
  });

  it('should setLifeCycleStatus to error when buildSwapTransaction throws an "User rejected the request." error', async () => {
    const mockError = new Error('User rejected the request.');
    vi.mocked(buildSwapTransaction).mockRejectedValueOnce(mockError);
    renderWithProviders({ Component: TestSwapComponent });
    fireEvent.click(screen.getByText('Swap'));
    await waitFor(() => {
      expect(
        screen.getByTestId('context-value-lifeCycleStatus-statusName')
          .textContent,
      ).toBe('error');
      expect(
        screen.getByTestId('context-value-lifeCycleStatus-statusData-code')
          .textContent,
      ).toBe('TmSPc02');
    });
  });

  it('should setLifeCycleStatus to error when buildSwapTransaction throws an error', async () => {
    const mockError = new Error('Test error');
    vi.mocked(buildSwapTransaction).mockRejectedValueOnce(mockError);
    renderWithProviders({ Component: TestSwapComponent });
    fireEvent.click(screen.getByText('Swap'));
    await waitFor(() => {
      expect(
        screen.getByTestId('context-value-lifeCycleStatus-statusName')
          .textContent,
      ).toBe('error');
      expect(
        screen.getByTestId('context-value-lifeCycleStatus-statusData-code')
          .textContent,
      ).toBe('TmSPc02');
    });
  });

  it('should setLifeCycleStatus to error when buildSwapTransaction returns an error', async () => {
    vi.mocked(buildSwapTransaction).mockResolvedValueOnce({
      code: getSwapErrorCode('uncaught-swap'),
      error: 'Something went wrong',
      message: '',
    });
    renderWithProviders({ Component: TestSwapComponent });
    fireEvent.click(screen.getByText('Swap'));
    await waitFor(() => {
      expect(
        screen.getByTestId('context-value-lifeCycleStatus-statusName')
          .textContent,
      ).toBe('error');
      expect(
        screen.getByTestId('context-value-lifeCycleStatus-statusData-code')
          .textContent,
      ).toBe('UNCAUGHT_SWAP_ERROR');
    });
  });
});
