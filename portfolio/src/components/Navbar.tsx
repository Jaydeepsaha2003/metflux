
import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/router";
import { cn } from "@/lib/utils";
import { Menu, X, ChevronDown } from "lucide-react";
import globalProductsData from '../../global_products.json';

interface NavItem {
  label: string;
  href: string;
  type: string;
}

interface SiteInfo {
  name: string;
  logo: string;
  wordmark?: string;
  description: string;
}

interface NavbarProps {
  navData: {
    main: NavItem[];
  };
  siteInfo: SiteInfo;
}

const Navbar: React.FC<NavbarProps> = ({ navData, siteInfo }) => {
  const router = useRouter();
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isCRGODropdownOpen, setIsCRGODropdownOpen] = useState(false);

  // Timeout ref for managing dropdown close delay
  const crgoTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };
    
    const handleClickOutside = (event: Event) => {
      const target = event.target as Element;
      if (!target.closest('.crgo-dropdown-container')) {
        setIsCRGODropdownOpen(false);
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    document.addEventListener('click', handleClickOutside);

    return () => {
      window.removeEventListener("scroll", handleScroll);
      document.removeEventListener('click', handleClickOutside);
      if (crgoTimeoutRef.current) {
        clearTimeout(crgoTimeoutRef.current);
      }
    };
  }, []);

  const toggleMenu = () => {
    const newState = !isMenuOpen;
    setIsMenuOpen(newState);
    
    // Prevent body scroll when menu is open
    if (typeof document !== 'undefined') {
      if (newState) {
        document.body.style.overflow = 'hidden';
        document.body.style.position = 'fixed';
        document.body.style.top = '0';
        document.body.style.left = '0';
        document.body.style.right = '0';
      } else {
        document.body.style.overflow = '';
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.left = '';
        document.body.style.right = '';
      }
    }
  };

  const toggleCRGODropdown = () => {
    setIsCRGODropdownOpen(!isCRGODropdownOpen);
  };

  const closeCRGODropdown = () => {
    setIsCRGODropdownOpen(false);
  };

  const closeAllDropdowns = () => {
    setIsCRGODropdownOpen(false);
  };

  const handleCRGOMouseEnter = () => {
    if (crgoTimeoutRef.current) {
      clearTimeout(crgoTimeoutRef.current);
      crgoTimeoutRef.current = null;
    }
    setIsCRGODropdownOpen(true);
  };

  const handleCRGOMouseLeave = () => {
    crgoTimeoutRef.current = setTimeout(() => {
      setIsCRGODropdownOpen(false);
    }, 300);
  };

  const closeMobileMenu = () => {
    setIsMenuOpen(false);
    if (typeof document !== 'undefined') {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.left = '';
      document.body.style.right = '';
    }
  };

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (isMenuOpen) {
      closeMobileMenu();
    }
  };

  return (
    <>
      <header
        className={cn(
          "fixed top-0 left-0 right-0 z-50 py-2 sm:py-3 md:py-4 transition-all duration-300",
          isScrolled 
            ? "bg-white backdrop-blur-md shadow-sm" 
            : "bg-white shadow-sm"
        )}
      >
      <div className="container flex items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link 
          href="/" 
          className="flex items-center space-x-2"
          onClick={() => {
            scrollToTop();
          }}
          aria-label={siteInfo.name}
        >
          {/* Logo + Company Name style matching footer */}
          <div className="flex items-center space-x-3">
            <Image
              src={siteInfo.logo} 
              alt={`${siteInfo.name} logo`} 
              width={56}
              height={56}
              className="h-10 sm:h-12 md:h-14 w-auto object-contain"
              priority
            />
            <div>
              <h1 className={cn(
                "text-xl sm:text-2xl font-bold transition-colors duration-300",
                "text-gray-900"
              )}>{siteInfo.name}</h1>
              <p className={cn(
                "text-xs sm:text-sm font-medium hidden sm:block transition-colors duration-300",
                "text-pulse-500"
              )}>Electrical Excellence</p>
            </div>
          </div>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex space-x-6">
          {navData.main.map((item, index) => {
            // Skip the Products item as we'll replace it with two separate dropdowns
            if (item.label === 'Products') {
              return null;
            }
            
            // Regular navigation items
            return (
              <Link 
                key={index}
                href={item.href} 
                className={cn(
                  "nav-link transition-colors duration-300 text-base font-medium",
                  "text-gray-700 hover:text-pulse-600"
                )}
                onClick={() => {
                  if (item.href === '/') {
                    scrollToTop();
                  }
                  closeAllDropdowns();
                }}
              >
                {item.label}
              </Link>
            );
          })}
          
          {/* CRGO Products Dropdown */}
          <div 
            className="relative crgo-dropdown-container"
            onMouseEnter={handleCRGOMouseEnter}
            onMouseLeave={handleCRGOMouseLeave}
          >
            <button 
              className={cn(
                "flex items-center space-x-1 bg-transparent border-none cursor-pointer transition-colors duration-300 text-base font-medium px-2 py-2 whitespace-nowrap",
                "text-gray-700 hover:text-pulse-600 focus:outline-none"
              )}
              onClick={toggleCRGODropdown}
            >
              <span>CRGO Products</span>
              <ChevronDown className={cn(
                "w-4 h-4 transition-transform duration-200",
                isCRGODropdownOpen ? "rotate-180" : ""
              )} />
            </button>
            
            {/* CRGO Products Dropdown */}
            {isCRGODropdownOpen && (
              <div 
                className="absolute top-full left-1/2 transform -translate-x-1/2 mt-2 bg-white rounded-xl shadow-2xl border border-gray-200/50 overflow-hidden w-[420px] max-w-[95vw] z-50 backdrop-blur-sm"
              >
                <div className="p-5">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4 px-1">CRGO Products</h3>
                  <div className="space-y-1 max-h-[60vh] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent">
                    {globalProductsData.products.map((product) => (
                      <Link
                        key={product.id}
                        href={`/products/${product.slug}`}
                        className="block p-3 rounded-lg hover:bg-gray-50/80 transition-all duration-150 group border border-transparent hover:border-gray-100"
                        onClick={closeCRGODropdown}
                      >
                        <div className="flex items-start space-x-3">
                          <div className="flex-shrink-0">
                            <Image
                              src={product.image}
                              alt={product.title}
                              width={44}
                              height={44}
                              className="w-11 h-11 rounded-lg object-cover bg-gray-100 ring-1 ring-gray-200/50"
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-gray-900 group-hover:text-pulse-600 transition-colors mb-1 leading-snug truncate">
                              {product.title}
                            </p>
                            <p className="text-xs text-gray-500 leading-relaxed line-clamp-1">
                              {product.subtitle}
                            </p>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </nav>

        {/* Mobile menu button - increased touch target */}
        <button 
          className={cn(
            "md:hidden p-3 focus:outline-none transition-colors duration-300",
            "text-gray-700"
          )}
          onClick={toggleMenu}
          aria-label={isMenuOpen ? "Close menu" : "Open menu"}
        >
          {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile Navigation - improved for better touch experience */}
      <div className={cn(
        "fixed inset-0 z-40 bg-white md:hidden transition-all duration-300 ease-in-out",
        isMenuOpen 
          ? "opacity-100 visible transform translate-x-0" 
          : "opacity-0 invisible transform translate-x-full"
      )}>
        <div className="flex flex-col h-full overflow-y-auto">
          {/* Mobile menu content */}
          <div className="flex-1 pt-20 pb-8 px-6">
            <nav className="flex flex-col space-y-2">
          {navData.main.map((item, index) => {
            // Skip the Products item as we'll replace it with two separate categories
            if (item.label === 'Products') {
              return null;
            }
            
            // Regular mobile navigation items
            return (
              <Link 
                key={index}
                href={item.href} 
                className="text-xl font-medium py-3 px-6 w-full text-center rounded-lg hover:bg-gray-100 transition-colors duration-150" 
                onClick={() => {
                  if (item.href === '/') {
                    scrollToTop();
                  } else {
                    closeMobileMenu();
                  }
                }}
              >
                {item.label}
              </Link>
            );
          })}
          
          {/* Mobile Product Categories as regular nav items */}
          <button 
            className="text-xl font-medium py-3 px-6 w-full text-center rounded-lg hover:bg-gray-100 transition-colors duration-150 text-gray-900"
            onClick={() => {
              closeMobileMenu();
              // Scroll to products section on homepage
              if (router.pathname === '/') {
                setTimeout(() => {
                  const productsSection = document.getElementById('products');
                  if (productsSection) {
                    const offset = 80; // Account for fixed header
                    window.scrollTo({
                      top: productsSection.offsetTop - offset,
                      behavior: 'smooth'
                    });
                  }
                }, 100);
              } else {
                // Navigate to homepage and then scroll
                router.push('/').then(() => {
                  setTimeout(() => {
                    const productsSection = document.getElementById('products');
                    if (productsSection) {
                      const offset = 80;
                      window.scrollTo({
                        top: productsSection.offsetTop - offset,
                        behavior: 'smooth'
                      });
                    }
                  }, 200);
                });
              }
            }}
          >
            CRGO Products
          </button>
          
            </nav>
          </div>
        </div>
      </div>
      </header>
      
      {/* Internal styles for dropdown animations and positioning */}
      <style jsx>{`
        .crgo-dropdown-container .absolute,
        .transformer-dropdown-container .absolute {
          animation: dropdownFadeIn 0.2s ease-out;
        }
        
        @keyframes dropdownFadeIn {
          from {
            opacity: 0;
            transform: translateY(-8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        /* Ensure line clamp works */
        .line-clamp-1 {
          display: -webkit-box;
          -webkit-line-clamp: 1;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        
        /* Custom scrollbar for better UX */
        .scrollbar-thin::-webkit-scrollbar {
          width: 4px;
        }
        
        .scrollbar-thin::-webkit-scrollbar-track {
          background: transparent;
        }
        
        .scrollbar-thumb-gray-300::-webkit-scrollbar-thumb {
          background-color: rgba(209, 213, 219, 0.5);
          border-radius: 2px;
        }
        
        .scrollbar-thumb-gray-300::-webkit-scrollbar-thumb:hover {
          background-color: rgba(209, 213, 219, 0.8);
        }
        
        /* Prevent horizontal overflow */
        .crgo-dropdown-container,
        .transformer-dropdown-container {
          position: relative;
        }
        
        /* Responsive dropdown positioning */
        @media (max-width: 768px) {
          .crgo-dropdown-container .absolute,
          .transformer-dropdown-container .absolute {
            left: 50% !important;
            right: auto !important;
            transform: translateX(-50%) !important;
            max-width: 95vw;
          }
        }
      `}</style>
    </>
  );
};

export default Navbar;
