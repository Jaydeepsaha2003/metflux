import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Eye, ArrowRight, Zap, Shield, Power, Settings, Layers, Home, Wrench } from "lucide-react";

const TransformerProducts = () => {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  
  // Transformer products data with stock images
  const transformerProducts = [
    {
      id: 1,
      slug: 'lt-ct',
      src: `https://images.unsplash.com/photo-1621905251918-48416bd8575a?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1000&q=80`,
      title: 'LT-CT (Low Tension Current Transformer)',
      category: 'Current Transformers',
      description: 'High-accuracy low tension current transformers designed for precise current measurement and protection in electrical systems up to 1kV.',
      icon: <Zap className="w-5 h-5" />
    },
    {
      id: 2,
      slug: 'lt-pt',
      src: `https://images.unsplash.com/photo-1558618666-fcd25c85cd64?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1000&q=80`,
      title: 'LT-PT (Low Tension Potential Transformer)',
      category: 'Voltage Transformers',
      description: 'Precision low tension potential transformers for accurate voltage measurement and monitoring in low voltage electrical networks.',
      icon: <Power className="w-5 h-5" />
    },
    {
      id: 3,
      slug: 'mv-ct',
      src: `https://images.unsplash.com/photo-1473341304170-971dccb5ac1e?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1000&q=80`,
      title: 'MV-CT (Medium Voltage Current Transformer)',
      category: 'Current Transformers',
      description: 'Robust medium voltage current transformers engineered for accurate current sensing in medium voltage systems up to 33kV.',
      icon: <Shield className="w-5 h-5" />
    },
    {
      id: 4,
      slug: 'mv-pt',
      src: `https://images.unsplash.com/photo-1518837695005-2083093ee35b?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1000&q=80`,
      title: 'MV-PT (Medium Voltage Potential Transformer)',
      category: 'Voltage Transformers',
      description: 'High-performance medium voltage potential transformers for precise voltage measurement in medium voltage distribution systems.',
      icon: <Layers className="w-5 h-5" />
    },
    {
      id: 5,
      slug: 'rvt-earthing-transformer',
      src: `https://images.unsplash.com/photo-1581092918056-0c4c3acd3789?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1000&q=80`,
      title: 'R.V.T/Earthing Transformer',
      category: 'Earthing Solutions',
      description: 'Residual voltage transformers and earthing transformers providing neutral earthing solutions for three-phase electrical systems.',
      icon: <Settings className="w-5 h-5" />
    },
    {
      id: 6,
      slug: 'outdoor-transformer',
      src: `https://images.unsplash.com/photo-1606844756768-637ccdf25bb4?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1000&q=80`,
      title: 'Outdoor Transformer',
      category: 'Outdoor Solutions',
      description: 'Weather-resistant outdoor transformers designed for harsh environmental conditions with superior insulation and protection.',
      icon: <Home className="w-5 h-5" />
    },
    {
      id: 7,
      slug: 'control-transformer',
      src: `https://images.unsplash.com/photo-1518837695005-2083093ee35b?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1000&q=80`,
      title: 'Control Transformer',
      category: 'Control Systems',
      description: 'Precision control transformers for industrial automation, providing stable voltage supply for control circuits and instrumentation.',
      icon: <Wrench className="w-5 h-5" />
    }
  ];

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !isVisible) {
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

  return (
    <section 
      className={`py-12 sm:py-16 md:py-20 bg-white transition-all duration-1000 ${
        isVisible ? 'section-enter' : 'section-hidden'
      }`} 
      id="transformers" 
      ref={sectionRef}
    >
      <div className="section-container">
        {/* Header */}
        <div className="text-center mb-10 sm:mb-16">
          <h2 className="section-title mb-3 sm:mb-4 opacity-0 fade-in-element">
            Transformer Solutions
          </h2>
          <p className="section-subtitle mx-auto opacity-0 fade-in-element">
            Comprehensive range of transformers engineered for precision, reliability, and optimal performance across all voltage levels.
          </p>
        </div>
        
        {/* Transformers Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
          {transformerProducts.map((product, index) => {
            // Calculate animation delay for staggered effect
            const row = Math.floor(index / 3); // 3 cards per row
            const position = index % 3;
            const baseDelay = 0.6;
            const rowDelay = row * 0.3;
            const cardDelay = position * 0.12;
            const totalDelay = baseDelay + rowDelay + cardDelay;
            
            return (
              <div
                key={product.id}
                className={`product-card group relative overflow-hidden bg-white rounded-2xl shadow-elegant hover:shadow-elegant-hover transition-all duration-500 cursor-pointer transform hover:-translate-y-2 border border-gray-100 ${
                  isVisible ? 'card-entrance opacity-0' : 'opacity-0'
                }`}
                style={{ 
                  animationDelay: isVisible ? `${totalDelay}s` : '0s',
                  animationFillMode: 'forwards'
                }}
              >
                {/* Image Container */}
                <div className="relative overflow-hidden bg-gradient-to-br from-gray-50 to-gray-100 h-56">
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
                        <span>View Details</span>
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
                <div className="p-5">
                  <div className="mb-3">
                    <h3 className="text-lg font-display font-bold text-gray-900 group-hover:text-pulse-600 transition-colors duration-200 leading-tight">
                      {product.title}
                    </h3>
                  </div>
                  <p className="text-gray-600 text-sm leading-relaxed mb-4 line-clamp-3">
                    {product.description}
                  </p>
                  
                  {/* CTA Button */}
                  <Link 
                    href={`/products/${product.slug}`}
                    className="w-full flex items-center justify-center space-x-2 bg-gray-50 hover:bg-pulse-500 text-gray-700 hover:text-white py-2.5 px-4 rounded-full font-medium transition-all duration-300 group-hover:transform group-hover:scale-[1.02] text-sm"
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
        <div className="text-center mt-12 opacity-0 fade-in-element" style={{ animationDelay: "1.2s" }}>
          <p className="text-gray-600 mb-4">Need a custom transformer solution?</p>
          <Link href="/contact" className="button-primary inline-flex items-center space-x-2">
            <span>Get Custom Quote</span>
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
        
        /* Line clamp utility */
        .line-clamp-3 {
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
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

export default TransformerProducts;