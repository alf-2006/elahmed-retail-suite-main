import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { STORAGE_KEYS } from '@/config';
import PartnersPage from '@/pages/PartnersPage';

const mockConfirm = vi.fn();
const mockToast = vi.fn();
const mockGetAllInventoryProducts = vi.fn();

vi.mock('@/components/ui/toast', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('@/components/ConfirmDialog', () => ({
  useConfirm: () => mockConfirm,
}));

vi.mock('@/hooks/useFastData', () => ({
  useFastData: () => ({
    getAllInventoryProducts: mockGetAllInventoryProducts,
  }),
}));

describe('PartnersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock localStorage data
    localStorage.setItem(STORAGE_KEYS.PARTNERS, JSON.stringify([
      {
        id: '1',
        name: 'Test Partner',
        phone: '1234567890',
        address: 'Test Address',
        partnershipType: 'investor',
        sharePercent: 50,
        profitShareDevices: 30,
        profitShareAccessories: 20,
        capitalAmount: 10000,
        active: true,
        notes: 'Test notes',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]));
  });

  it('renders the partners page with existing partners', async () => {
    render(<PartnersPage />);

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Test Partner')).toBeInTheDocument();
    });

    expect(screen.getByText('Test Partner')).toBeInTheDocument();
    expect(screen.getByText('1234567890')).toBeInTheDocument();
    expect(screen.getByText('Test Address')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('adds a new partner', async () => {
    render(<PartnersPage />);

    // Click add button
    const addButton = screen.getByRole('button', { name: /\u0623\u0636\u0641\u0641 \u0634\u0631\u064a\u0643 \u062c\u062f\u064a\u062f/i });
    fireEvent.click(addButton);

    // Fill form
    const nameInput = screen.getByLabelText(/\u0627\u0644\u0627\u0633\u0645/i);
    const phoneInput = screen.getByLabelText(/\u0627\u0644\u0647\u0627\u062a\u0641/i);
    const addressInput = screen.getByLabelText(/\u0627\u0644\u0639\u0646\u0648\u0627\u0646/i);
    const typeSelect = screen.getByLabelText(/\u0646\u0648\u0639 \u0627\u0644\u0634\u0631\u0627\u0643\u0629/i);
    const sharePercentInput = screen.getByLabelText(/\u0646\u0633\u0628\u0629 \u0627\u0644\u0645\u0634\u0627\u0631\u0643\u0629/i);
    const saveButton = screen.getByRole('button', { name: /\u062d\u0641\u0638/i });

    fireEvent.change(nameInput, { target: { value: 'New Partner' } });
    fireEvent.change(phoneInput, { target: { value: '0987654321' } });
    fireEvent.change(addressInput, { target: { value: 'New Address' } });
    fireEvent.change(typeSelect, { target: { value: 'franchise' } });
    fireEvent.change(sharePercentInput, { target: { value: '40' } });

    fireEvent.click(saveButton);

    // Verify partner was added
    await waitFor(() => {
      expect(screen.getByText('New Partner')).toBeInTheDocument();
      expect(screen.getByText('0987654321')).toBeInTheDocument();
      expect(screen.getByText('New Address')).toBeInTheDocument();
      expect(screen.getByText('40%')).toBeInTheDocument();
    });
  });

  it('edits an existing partner', async () => {
    render(<PartnersPage />);

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Test Partner')).toBeInTheDocument();
    });

    // Click edit button
    const editButton = screen.getByRole('button', { name: /\u062a\u0639\u062f\u064a\u0644/i });
    fireEvent.click(editButton);

    // Edit form
    const nameInput = screen.getByLabelText(/\u0627\u0644\u0627\u0633\u0645/i);
    const saveButton = screen.getByRole('button', { name: /\u062d\u0641\u0638/i });

    fireEvent.change(nameInput, { target: { value: 'Updated Partner' } });
    fireEvent.click(saveButton);

    // Verify partner was updated
    await waitFor(() => {
      expect(screen.getByText('Updated Partner')).toBeInTheDocument();
    });
  });

  it('deletes a partner', async () => {
    render(<PartnersPage />);

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Test Partner')).toBeInTheDocument();
    });

    // Click delete button
    const deleteButton = screen.getByRole('button', { name: /\u062d\u0630\u0641/i });
    fireEvent.click(deleteButton);

    // Confirm deletion
    expect(mockConfirm).toHaveBeenCalled();
    mockConfirm.mockResolvedValue(true);

    // Verify partner was deleted
    await waitFor(() => {
      expect(screen.queryByText('Test Partner')).not.toBeInTheDocument();
    });
  });

  it('shows correct partner count', async () => {
    render(<PartnersPage />);

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('1 \u0634\u0631\u064a\u0643 \u0645\u0633\u062c\u0644')).toBeInTheDocument();
    });
  });

  it('filters partners by search', async () => {
    render(<PartnersPage />);

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Test Partner')).toBeInTheDocument();
    });

    // Search for partner
    const searchInput = screen.getByPlaceholderText(/\u0628\u062d\u062b \u0641\u064a \u0627\u0644\u0634\u0631\u0643\u0627\u0621/i);
    fireEvent.change(searchInput, { target: { value: 'Test' } });

    // Verify partner is still visible
    expect(screen.getByText('Test Partner')).toBeInTheDocument();
  });
});