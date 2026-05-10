import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { ArrowRight, Home, ChevronRight, Zap, Shield, Cpu, Wrench, Target, Settings, CheckCircle, Star, Award, Truck } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import MultiTextImageSection from "@/components/MultiTextImageSection";
import ConnectSection from "@/components/ConnectSection";
import globalProductsData from '../../global_products.json';
import siteData from "@/data/siteData.json";

const ProductDetail = () => {
  const router = useRouter();
  const { slug } = router.query;
  const product = globalProductsData.products.find(p => p.slug === slug);
  const sectionRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  // Icon mapping for different product categories
  const getProductIcon = (productId: string) => {
    const iconMap: Record<string, React.ReactNode> = {
      'crgo-mother-coils': <Zap className="w-6 h-6" />,
      'crgo-slit-coils': <Target className="w-6 h-6" />,
      'crgo-lamination': <Shield className="w-6 h-6" />,
      'crgo-core-assembly': <Cpu className="w-6 h-6" />,
      'crgo-core-coil-assembly': <Settings className="w-6 h-6" />,
      'amorphous-core': <Wrench className="w-6 h-6" />,
      'oil-immersed-circuit-breaker': <Shield className="w-6 h-6" />,
      'wound-cores': <Target className="w-6 h-6" />,
      'toroidal-cores': <Cpu className="w-6 h-6" />
    };
    return iconMap[productId] || <Zap className="w-6 h-6" />;
  };

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true);
            
            const elements = entry.target.querySelectorAll(".fade-in-element");
            elements.forEach((el, index) => {
              setTimeout(() => {
                el.classList.add("animate-fade-in");
              }, index * 150);
            });
          }
        });
      },
      { threshold: 0.1 }
    );
    
    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }
    
    return () => {
      if (sectionRef.current) {
        observer.unobserve(sectionRef.current);
      }
    };
  }, []);


  if (!product) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Product Not Found</h1>
          <p className="text-gray-600 mb-8">The product you're looking for doesn't exist.</p>
          <Link href="/products" className="button-primary inline-flex items-center space-x-2">
            <span>Browse All Products</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar navData={siteData.navigation} siteInfo={siteData.site} />
      
      {/* Hero Section with Breadcrumbs */}
      <section className="pt-20 pb-12 bg-gradient-to-br from-gray-900 via-gray-800 to-pulse-900">
        <div className="section-container">
          {/* Breadcrumbs */}
          <nav className="flex items-center space-x-2 text-sm text-gray-300 mb-8">
            <Link href="/" className="hover:text-white transition-colors flex items-center space-x-1">
              <Home className="w-4 h-4" />
              <span>Home</span>
            </Link>
            <ChevronRight className="w-4 h-4" />
            <span className="text-pulse-400">{product.title}</span>
          </nav>
          
          <div className="text-center text-white">
            <div className="pulse-chip mx-auto mb-4 bg-white/10 border-white/20">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-pulse-500 text-white mr-2">
                {getProductIcon(product.id)}
              </span>
              <span>{product.subtitle}</span>
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold mb-4">
              {product.title}
            </h1>
            <p className="text-xl text-gray-300 max-w-3xl mx-auto">
              {product.description.length > 150 ? product.description.substring(0, 150) + '...' : product.description}
            </p>
            
            {/* Stats Badge */}
            {product.stats && (
              <div className="inline-flex items-center space-x-2 bg-white/10 backdrop-blur-sm rounded-full px-4 py-2 mt-6">
                <Award className="w-5 h-5 text-pulse-400" />
                <span className="text-white font-semibold">{product.stats.value}% {product.stats.label}</span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Main Content */}
      <section className="py-16" ref={sectionRef}>
        <div className="section-container">

{/* Product Overview Section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 fade-in-element">
            {/* Product Image */}
            <div className="space-y-6">
              <div className="relative overflow-hidden rounded-2xl shadow-elegant h-96 bg-gradient-to-br from-gray-100 to-gray-200">
                <div 
                  className="absolute inset-0 bg-cover bg-center transition-transform duration-700 hover:scale-105"
                  style={{ backgroundImage: `url('${product.image || '/lovable-uploads/5663820f-6c97-4492-9210-9eaa1a8dc415.png'}')` }}
                />
                <div className="absolute top-4 left-4">
                  <span className="px-3 py-1 bg-white/90 backdrop-blur-sm text-pulse-600 text-sm font-semibold rounded-full flex items-center space-x-2">
                    {getProductIcon(product.id)}
                    <span>{product.subtitle}</span>
                  </span>
                </div>
              </div>
              
              {/* Key Benefits */}
              <div className="bg-white rounded-2xl p-6 shadow-elegant">
                <h3 className="text-xl font-display font-bold text-gray-900 mb-4 flex items-center space-x-2">
                  <CheckCircle className="w-6 h-6 text-pulse-500" />
                  <span>Key Benefits</span>
                </h3>
                <ul className="space-y-3">
                  <li className="flex items-start space-x-3">
                    <Star className="w-5 h-5 text-pulse-500 mt-0.5 flex-shrink-0" />
                    <span className="text-gray-600">High-performance engineering standards</span>
                  </li>
                  <li className="flex items-start space-x-3">
                    <Star className="w-5 h-5 text-pulse-500 mt-0.5 flex-shrink-0" />
                    <span className="text-gray-600">Worldwide industrial applications</span>
                  </li>
                  <li className="flex items-start space-x-3">
                    <Star className="w-5 h-5 text-pulse-500 mt-0.5 flex-shrink-0" />
                    <span className="text-gray-600">Custom specifications available</span>
                  </li>
                  <li className="flex items-start space-x-3">
                    <Truck className="w-5 h-5 text-pulse-500 mt-0.5 flex-shrink-0" />
                    <span className="text-gray-600">Fast and reliable delivery</span>
                  </li>
                </ul>
              </div>
            </div>
            
            {/* Product Details */}
            <div className="space-y-8">
              <div>
                <h2 className="text-3xl font-display font-bold text-gray-900 mb-6">Product Overview</h2>
                <p className="text-gray-600 text-lg leading-relaxed">
                  {product.description}
                </p>
              </div>
              
              {/* CTA Section */}
              <div className="bg-gradient-to-r from-pulse-500 to-pulse-600 rounded-2xl p-8 text-white">
                <h3 className="text-2xl font-bold mb-4">Ready to Get Started?</h3>
                <p className="mb-6 opacity-90">
                  Contact our engineering team for custom specifications, bulk orders, or technical consultation.
                </p>
                <div className="flex flex-col sm:flex-row gap-4">
                  <a href="#connect" className="bg-white text-pulse-600 px-6 py-3 rounded-full font-medium hover:bg-gray-100 transition-colors duration-200 flex items-center justify-center space-x-2">
                    <span>Request Quote</span>
                    <ArrowRight className="w-4 h-4" />
                  </a>
                  <button className="border border-white/30 text-white px-6 py-3 rounded-full font-medium hover:bg-white/10 transition-colors duration-200">
                    Download Brochure
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Product Features Section */}
          <div className="fade-in-element mt-24">
            <div className="text-center mb-12">
              <h2 className="text-3xl font-display font-bold text-gray-900 mb-4">Product Features</h2>
              <p className="text-xl text-gray-600 max-w-3xl mx-auto">
                Discover the advanced capabilities and specifications that make this product exceptional.
              </p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {product.features.map((feature, index) => (
                <div key={index} className="bg-white rounded-2xl p-8 shadow-elegant hover:shadow-elegant-hover transition-shadow duration-300">
                  <div className="flex items-start space-x-4">
                    <div className="flex-shrink-0 w-12 h-12 bg-pulse-100 rounded-full flex items-center justify-center">
                      {getProductIcon(product.id)}
                    </div>
                    <div>
                      <h3 className="text-xl font-display font-bold text-gray-900 mb-3">{feature.title}</h3>
                      <p className="text-gray-600 leading-relaxed">{feature.description}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Multi Text Image Section */}
          <div className="fade-in-element mt-24">
            <MultiTextImageSection />
          </div>

          {/* FAQs Section */}
          <div className="fade-in-element mt-24">
            <div className="text-center mb-12">
              <h2 className="text-3xl font-display font-bold text-gray-900 mb-4">Frequently Asked Questions</h2>
              <p className="text-xl text-gray-600 max-w-3xl mx-auto">
                Find answers to common questions about {product.title}.
              </p>
            </div>
            
            <div className="max-w-4xl mx-auto">
              <Accordion type="single" collapsible className="w-full space-y-4">
                {product.faqs.map((faq, index) => (
                  <AccordionItem 
                    key={faq.id} 
                    value={faq.id.toString()} 
                    className="glass-card border-0 shadow-elegant hover:shadow-elegant-hover transition-all duration-300"
                  >
                    <AccordionTrigger className="text-left hover:no-underline px-6 py-4 text-base sm:text-lg font-medium hover:text-pulse-500 transition-colors duration-200">
                      {faq.question}
                    </AccordionTrigger>
                    <AccordionContent className="px-6 pb-4 text-gray-600 text-sm sm:text-base leading-relaxed">
                      {faq.answer}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          </div>

        </div>
      </section>

      {/* Connect Section */}
      <div id="connect">
        <ConnectSection />
      </div>

      <Footer />
    </div>
  );
};

export default ProductDetail;

