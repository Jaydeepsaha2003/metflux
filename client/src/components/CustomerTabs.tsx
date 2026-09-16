import { NavLink } from 'react-router-dom';
import { Users, IndianRupee } from 'lucide-react';
import { useCan } from '@/store/auth';
import './customer-workspace.css';

export const CustomerTabs = () => {
  const customers = useCan('add_customer');
  const rates = useCan('view_po');
  return <nav className="customer-tabs" aria-label="Customer section">
    {customers && <NavLink to="/customers" end><Users size={15} /> Customers</NavLink>}
    {rates && <NavLink to="/customers/rates"><IndianRupee size={15} /> Rate card</NavLink>}
  </nav>;
};
