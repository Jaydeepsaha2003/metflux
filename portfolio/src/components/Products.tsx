import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Eye, ShoppingCart, ArrowRight, Zap, Shield, Cpu, Wrench, Target, Settings } from "lucide-react";
import globalProductsData from '../../global_products.json';

const Products = () => {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  
  // Icon mapping for different product categories
  const getProductIcon = (productId: string) => {
    const iconMap: Record<string, React.ReactNode> = {
      'crgo-mother-coils': <Zap className="w-5 h-5" />,
      'crgo-slit-coils': <Target className="w-5 h-5" />,
      'crgo-lamination': <Shield className="w-5 h-5" />,
      'crgo-core-assembly': <Cpu className="w-5 h-5" />,
      'crgo-core-coil-assembly': <Settings className="w-5 h-5" />,
      'amorphous-core': <Wrench className="w-5 h-5" />,
      'oil-immersed-circuit-breaker': <Shield className="w-5 h-5" />,
      'wound-cores': <Target className="w-5 h-5" />,
      'toroidal-cores': <Cpu className="w-5 h-5" />
    };
    return iconMap[productId] || <Zap className="w-5 h-5" />;
  };

  // Products data from global_products.json (first 6 products)
  const products = [
    {
      id: 1,
      slug: 'crgo-mother-coils',
      src: `/images/crgomothercoils.png`,
      title: 'CRGO Mother Coils',
      category: 'Premium Electrical Steel',
      description: 'High-quality CRGO mother coils are the primary source material for manufacturing transformer cores and electromagnetic devices.',
      icon: <Zap className="w-5 h-5" />
    },
    {
      id: 2,
      slug: 'crgo-slit-coils',
      src: `/images/crgoslitcoils.png`,
      title: 'CRGO Slit Coils',
      category: 'Precision-Cut Steel',
      description: 'Precision-cut CRGO slit coils from mother coils to meet exact width requirements for direct use in manufacturing lines.',
      icon: <Target className="w-5 h-5" />
    },
    {
      id: 3,
      slug: 'crgo-lamination',
      src: `/images/crgocorelamination.png`,
      title: 'CRGO Lamination',
      category: 'Transformer Laminations',
      description: 'High-performance CRGO laminations stamped or laser-cut from electrical steel, designed for optimal magnetic flux.',
      icon: <Shield className="w-5 h-5" />
    },
    {
      id: 4,
      slug: 'crgo-core-assembly',
      src: `/images/CRGOCoreAssembly.png`,
      title: 'CRGO Core Assembly',
      category: 'Fully Assembled Cores',
      description: 'Expertly constructed CRGO core assemblies from high-quality laminations to form the magnetic backbone of transformers.',
      icon: <Cpu className="w-5 h-5" />
    },
    {
      id: 5,
      slug: 'amorphous-core',
      src: `/images/amorphousCore.png`,
      title: 'Amorphous Core',
      category: 'Ultra-High Efficiency',
      description: 'Amorphous metal cores offering significantly lower core losses compared to traditional CRGO steel for high-efficiency transformers.',
      icon: <Wrench className="w-5 h-5" />
    },
    {
      id: 6,
      slug: 'wound-cores',
      src: `/images/woundCore.png`,
      title: 'Wound Cores',
      category: 'High-Performance Cores',
      description: 'Wound cores constructed by winding electrical steel tape, offering closed magnetic path and high efficiency design.',
      icon: <Settings className="w-5 h-5" />
    }
  ];

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !isVisible) {
            // Section is entering viewport for the first time
            setIsVisible(true);
            
            // Trigger header animations
            const elements = entry.target.querySelectorAll(".fade-in-element");
            elements.forEach((el, index) => {
              setTimeout(() => {
                el.classList.add("animate-fade-in");
              }, index * 100);
            });
          }
        });
      },
      { 
        threshold: 0.1,
        rootMargin: '50px 0px'
      }
    );
    
    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }
    
    return () => {
      if (sectionRef.current) {
        observer.unobserve(sectionRef.current);
      }
    };
  }, [isVisible]);

  const handleProductClick = (product: typeof products[0]) => {
    // Navigation is now handled by Link components
    console.log(`Viewing product: ${product.title}`);
  };

  return (
    <section 
      className={`py-12 sm:py-16 md:py-20 bg-gray-50 transition-all duration-1000 ${
        isVisible ? 'section-enter' : 'section-hidden'
      }`} 
      id="products" 
      ref={sectionRef}
    >
      <div className="section-container">
        {/* Header */}
        <div className="text-center mb-10 sm:mb-16">
          <h2 className="section-title mb-3 sm:mb-4 opacity-0 fade-in-element">
            Our Products
          </h2>
          <p className="section-subtitle mx-auto opacity-0 fade-in-element">
            From CRGO laminations to turnkey transformer solutions, we deliver excellence at every stage.
          </p>
        </div>
        
        {/* Products Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
          {products.map((product, index) => {
            // Calculate row and position for staggered animation
            const row = Math.floor(index / 3); // 3 cards per row on desktop
            const position = index % 3;
            const baseDelay = 0.6; // Start after header animations
            const rowDelay = row * 0.4; // Delay between rows
            const cardDelay = position * 0.15; // Stagger within row
            const totalDelay = baseDelay + rowDelay + cardDelay;
            
            return (
              <div
                key={product.id}
                className={`product-card group relative overflow-hidden bg-white rounded-2xl shadow-elegant hover:shadow-elegant-hover transition-all duration-500 cursor-pointer transform hover:-translate-y-2 ${
                  isVisible ? 'card-entrance opacity-0' : 'opacity-0'
                }`}
                style={{ 
                  animationDelay: isVisible ? `${totalDelay}s` : '0s',
                  animationFillMode: 'forwards'
                }}
              >
              {/* Image Container */}
              <div className="relative overflow-hidden bg-gradient-to-br from-gray-100 to-gray-200 h-64">
                <div 
                  className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-110"
                  style={{
                    backgroundImage: `url('${product.src}')`,
                  }}
                />
                
                {/* Hover Overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                
                    {/* View Product Button */}
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-y-4 group-hover:translate-y-0">
                      <div className="flex items-center space-x-3">
                        <Link 
                          href={`/products/${product.slug}`}
                          className="flex items-center space-x-2 bg-white text-pulse-600 px-4 py-2 rounded-full font-medium hover:bg-pulse-50 transition-colors duration-200"
                        >
                          <Eye className="w-4 h-4" />
                          <span>View Product</span>
                        </Link>
                        <Link 
                          href={`/products/${product.slug}`}
                          className="flex items-center justify-center w-10 h-10 bg-pulse-500 text-white rounded-full hover:bg-pulse-600 transition-colors duration-200"
                        >
                          <ArrowRight className="w-4 h-4" />
                        </Link>
                      </div>
                    </div>
              </div>
              
              {/* Content */}
              <div className="p-6">
                <div className="mb-2">
                  <h3 className="text-xl font-display font-bold text-gray-900 group-hover:text-pulse-600 transition-colors duration-200">
                    {product.title}
                  </h3>
                </div>
                <p className="text-gray-600 text-sm leading-relaxed mb-4">
                  {product.description}
                </p>
                
                {/* CTA Button */}
                <Link 
                  href={`/products/${product.slug}`}
                  className="w-full flex items-center justify-center space-x-2 bg-gray-100 hover:bg-pulse-500 text-gray-700 hover:text-white py-3 px-4 rounded-full font-medium transition-all duration-300 group-hover:transform group-hover:scale-[1.02]"
                >
                  <span>Learn More</span>
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                </Link>
              </div>
            </div>
            );
          })}
        </div>
        
        {/* CTA Section */}
        <div className="text-center mt-12 opacity-0 fade-in-element" style={{ animationDelay: "1.0s" }}>
          <p className="text-gray-600 mb-4">Explore our complete product catalog</p>
          <Link href="/products" className="button-primary inline-flex items-center space-x-2">
            <span>View All Products</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
      
      <style>{`
        .product-card {
          cursor: pointer;
        }
        
        .product-card:hover {
          cursor: pointer;
        }
        
        @media (min-width: 768px) {
          .product-card:hover {
            transform: translateY(-8px);
          }
        }
        
        /* Section animations */
        .section-hidden {
          opacity: 0;
          transform: translateY(30px);
        }
        
        .section-enter {
          opacity: 1;
          transform: translateY(0);
          animation: sectionSlideIn 1s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
        }
        
        .section-exit {
          animation: sectionSlideOut 0.6s cubic-bezier(0.4, 0.0, 0.6, 1) forwards;
        }
        
        @keyframes sectionSlideIn {
          0% {
            opacity: 0;
            transform: translateY(50px) scale(0.98);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        
        @keyframes sectionSlideOut {
          0% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
          100% {
            opacity: 0;
            transform: translateY(-30px) scale(0.98);
          }
        }
        
        /* Card entrance animation */
        .card-entrance {
          animation: cardSlideIn 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
        }
        
        /* Card exit animation */
        .card-exit {
          animation: cardSlideOut 0.5s cubic-bezier(0.4, 0.0, 0.6, 1) forwards;
        }
        
        @keyframes cardSlideIn {
          0% {
            opacity: 0;
            transform: translateY(60px) scale(0.9);
          }
          60% {
            opacity: 0.8;
            transform: translateY(-10px) scale(1.02);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        
        @keyframes cardSlideOut {
          0% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
          100% {
            opacity: 0;
            transform: translateY(-40px) scale(0.9);
          }
        }
        
        /* Mobile adjustments */
        @media (max-width: 767px) {
          @keyframes cardSlideIn {
            0% {
              opacity: 0;
              transform: translateX(-30px) scale(0.95);
            }
            60% {
              opacity: 0.8;
              transform: translateX(5px) scale(1.01);
            }
            100% {
              opacity: 1;
              transform: translateX(0) scale(1);
            }
          }
          
          @keyframes cardSlideOut {
            0% {
              opacity: 1;
              transform: translateX(0) scale(1);
            }
            100% {
              opacity: 0;
              transform: translateX(30px) scale(0.95);
            }
          }
          
          @keyframes sectionSlideIn {
            0% {
              opacity: 0;
              transform: translateX(-20px) scale(0.98);
            }
            100% {
              opacity: 1;
              transform: translateX(0) scale(1);
            }
          }
          
          @keyframes sectionSlideOut {
            0% {
              opacity: 1;
              transform: translateX(0) scale(1);
            }
            100% {
              opacity: 0;
              transform: translateX(20px) scale(0.98);
            }
          }
        }
      `}</style>
    </section>
  );
};

export default Products;

