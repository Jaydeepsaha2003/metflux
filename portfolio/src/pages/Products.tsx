import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Eye, ArrowRight, Zap, Shield, Cpu, Wrench, Target, Settings } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import globalProductsData from '../../global_products.json';
import siteData from "@/data/siteData.json";

const ProductsPage = () => {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  
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

  // Transform the JSON data to match our component structure
  const products = globalProductsData.products.map((product, index) => ({
    id: index + 1,
    slug: product.slug,
    src: product.image || `/lovable-uploads/5663820f-6c97-4492-9210-9eaa1a8dc415.png`,
    title: product.title,
    category: product.subtitle,
    description: product.description.length > 120 
      ? product.description.substring(0, 120) + '...' 
      : product.description,
    icon: getProductIcon(product.id),
  }));

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true);
            setIsExiting(false);
            
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
        threshold: [0.1, 0.9],
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
    <div className="min-h-screen bg-gray-50">
      <Navbar navData={siteData.navigation} siteInfo={siteData.site} />
      
      {/* Hero Section */}
      <section className="pt-20 pb-12 bg-gradient-to-br from-gray-900 via-gray-800 to-pulse-900">
        <div className="section-container">
          <div className="text-center text-white">
            <div className="pulse-chip mx-auto mb-4 bg-white/10 border-white/20">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-pulse-500 text-white mr-2">
                <Zap className="w-3 h-3" />
              </span>
              <span>Our Products</span>
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold mb-4">
              Engineering <span className="text-pulse-400">Excellence</span>
            </h1>
            <p className="text-xl text-gray-300 max-w-3xl mx-auto">
              Discover our comprehensive range of high-performance electrical steel components and transformer solutions for industrial applications worldwide.
            </p>
          </div>
        </div>
      </section>
      
      {/* Products Grid Section */}
      <section 
        className={`py-16 transition-all duration-1000 ${
          isVisible ? 'section-enter' : isExiting ? 'section-exit' : 'section-hidden'
        }`}
        ref={sectionRef}
      >
        <div className="section-container">
          {/* Section Header */}
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-display font-bold text-gray-900 mb-4 opacity-0 fade-in-element">
              Complete Product Range
            </h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto opacity-0 fade-in-element">
              From raw materials to fully assembled cores, we provide everything you need for transformer manufacturing.
            </p>
          </div>
          
          {/* Products Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {products.map((product, index) => {
              const row = Math.floor(index / 3);
              const position = index % 3;
              const baseDelay = 0.4;
              const rowDelay = row * 0.3;
              const cardDelay = position * 0.15;
              const totalDelay = baseDelay + rowDelay + cardDelay;
              
              return (
                <div
                  key={product.id}
                  className={`product-card group relative overflow-hidden bg-white rounded-2xl shadow-elegant hover:shadow-elegant-hover transition-all duration-500 transform hover:-translate-y-2 ${
                    isVisible ? 'card-entrance opacity-0' : isExiting ? 'card-exit' : 'opacity-0'
                  }`}
                  style={{ 
                    animationDelay: isVisible ? `${totalDelay}s` : isExiting ? `${(products.length - 1 - index) * 0.1}s` : '0s',
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
                    
                    {/* Category Badge */}
                    <div className="absolute top-4 left-4 z-10">
                      <span className="px-3 py-1 bg-white/90 backdrop-blur-sm text-pulse-600 text-xs font-semibold rounded-full flex items-center space-x-1">
                        {product.icon}
                        <span>{product.category}</span>
                      </span>
                    </div>
                    
                    {/* Hover Overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                    
                    {/* View Product Button */}
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-y-4 group-hover:translate-y-0">
                      <Link 
                        href={`/products/${product.slug}`}
                        className="flex items-center space-x-2 bg-white text-pulse-600 px-6 py-3 rounded-full font-medium hover:bg-pulse-50 transition-colors duration-200"
                      >
                        <Eye className="w-4 h-4" />
                        <span>View Details</span>
                      </Link>
                    </div>
                  </div>
                  
                  {/* Content */}
                  <div className="p-6">
                    <div className="mb-3">
                      <h3 className="text-xl font-display font-bold text-gray-900 group-hover:text-pulse-600 transition-colors duration-200">
                        {product.title}
                      </h3>
                    </div>
                    <p className="text-gray-600 text-sm leading-relaxed mb-6">
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
          <div className="text-center mt-16 opacity-0 fade-in-element" style={{ animationDelay: "1.2s" }}>
            <p className="text-gray-600 mb-6 text-lg">Need custom specifications or bulk orders?</p>
            <Link href="#" className="button-primary inline-flex items-center space-x-2">
              <span>Contact Our Engineering Team</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>
      
      <Footer />
      
    </div>
  );
};

export default ProductsPage;
