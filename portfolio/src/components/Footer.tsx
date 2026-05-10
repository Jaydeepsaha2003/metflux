
import React from "react";
import Link from "next/link";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { MapPin, Phone, Mail, ArrowRight, Linkedin, Twitter, Facebook, Instagram, ExternalLink } from "lucide-react";

const Footer = () => {

  return (
    <footer className="relative bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white overflow-hidden">
      {/* Background Pattern */}
      <div className="absolute inset-0 opacity-5">
        <div 
          className="absolute inset-0" 
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.1'%3E%3Cpath d='m36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`
          }} 
        />
      </div>
      
      {/* Main Footer Content */}
      <div className="relative z-10">
        {/* Top Section */}
        <div className="section-container py-12 md:py-16">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 md:gap-12">
            {/* Company Info */}
            <div className="md:col-span-2 lg:col-span-1 space-y-4 md:space-y-6">
              <div className="flex items-center space-x-3 md:space-x-4">
                <Image
                  src="/logo/LOGO-01.png" 
                  alt="Metflux logo" 
                  width={48}
                  height={48}
                  className="h-12 w-12 md:h-16 md:w-16 object-contain"
                />
                <div>
                  <h3 className="text-xl md:text-2xl font-bold text-white">Metflux</h3>
                  <p className="text-pulse-400 text-xs md:text-sm font-medium">Electrical Excellence</p>
                </div>
              </div>
              <p className="text-gray-300 leading-relaxed text-sm md:text-base">
                Leading manufacturer of CRGO electrical steel, transformer cores, and specialized electrical components for industrial applications worldwide.
              </p>
              
              {/* Social Links */}
              <div className="flex space-x-3 md:space-x-4">
                <a href="#" className="w-9 h-9 md:w-10 md:h-10 bg-gray-800 hover:bg-pulse-500 rounded-full flex items-center justify-center transition-all duration-300 hover:scale-110 hover:shadow-lg hover:shadow-pulse-500/25">
                  <Linkedin className="w-4 h-4 md:w-5 md:h-5" />
                </a>
                <a href="#" className="w-9 h-9 md:w-10 md:h-10 bg-gray-800 hover:bg-pulse-500 rounded-full flex items-center justify-center transition-all duration-300 hover:scale-110 hover:shadow-lg hover:shadow-pulse-500/25">
                  <Twitter className="w-4 h-4 md:w-5 md:h-5" />
                </a>
                <a href="#" className="w-9 h-9 md:w-10 md:h-10 bg-gray-800 hover:bg-pulse-500 rounded-full flex items-center justify-center transition-all duration-300 hover:scale-110 hover:shadow-lg hover:shadow-pulse-500/25">
                  <Facebook className="w-4 h-4 md:w-5 md:h-5" />
                </a>
                <a href="#" className="w-9 h-9 md:w-10 md:h-10 bg-gray-800 hover:bg-pulse-500 rounded-full flex items-center justify-center transition-all duration-300 hover:scale-110 hover:shadow-lg hover:shadow-pulse-500/25">
                  <Instagram className="w-4 h-4 md:w-5 md:h-5" />
                </a>
              </div>
            </div>
            
            {/* Quick Links */}
            <div className="space-y-4 md:space-y-6">
              <h4 className="text-base md:text-lg font-bold text-white relative">
                Quick Links
                <div className="absolute -bottom-1 left-0 w-8 h-0.5 bg-pulse-500 rounded-full"></div>
              </h4>
              <ul className="space-y-2 md:space-y-3">
                <li>
                  <Link href="/" className="text-gray-300 hover:text-pulse-400 transition-colors duration-200 flex items-center space-x-2 group text-sm md:text-base">
                    <ArrowRight className="w-3 h-3 md:w-4 md:h-4 transform group-hover:translate-x-1 transition-transform duration-200" />
                    <span>Home</span>
                  </Link>
                </li>
                <li>
                  <Link href="/about" className="text-gray-300 hover:text-pulse-400 transition-colors duration-200 flex items-center space-x-2 group text-sm md:text-base">
                    <ArrowRight className="w-3 h-3 md:w-4 md:h-4 transform group-hover:translate-x-1 transition-transform duration-200" />
                    <span>About Us</span>
                  </Link>
                </li>
                <li>
                  <a 
                    href="/#products" 
                    className="text-gray-300 hover:text-pulse-400 transition-colors duration-200 flex items-center space-x-2 group text-sm md:text-base"
                  onClick={(e) => {
                    e.preventDefault();
                    if (typeof window !== 'undefined') {
                      if (window.location.pathname === '/') {
                        const element = document.getElementById('products');
                        if (element) {
                          element.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }
                      } else {
                        window.location.href = '/#products';
                      }
                    }
                  }}
                  >
                    <ArrowRight className="w-3 h-3 md:w-4 md:h-4 transform group-hover:translate-x-1 transition-transform duration-200" />
                    <span>Products</span>
                  </a>
                </li>
                <li>
                  <Link href="/contact" className="text-gray-300 hover:text-pulse-400 transition-colors duration-200 flex items-center space-x-2 group text-sm md:text-base">
                    <ArrowRight className="w-3 h-3 md:w-4 md:h-4 transform group-hover:translate-x-1 transition-transform duration-200" />
                    <span>Contact</span>
                  </Link>
                </li>
              </ul>
            </div>
            
            {/* Products */}
            <div className="space-y-4 md:space-y-6">
              <h4 className="text-base md:text-lg font-bold text-white relative">
                Our Products
                <div className="absolute -bottom-1 left-0 w-8 h-0.5 bg-pulse-500 rounded-full"></div>
              </h4>
              <ul className="space-y-2 md:space-y-3">
                <li>
                  <Link href="/products/crgo-mother-coils" className="text-gray-300 hover:text-pulse-400 transition-colors duration-200 flex items-center space-x-2 group text-sm md:text-base">
                    <ArrowRight className="w-3 h-3 md:w-4 md:h-4 transform group-hover:translate-x-1 transition-transform duration-200" />
                    <span>CRGO Mother Coils</span>
                  </Link>
                </li>
                <li>
                  <Link href="/products/crgo-slit-coils" className="text-gray-300 hover:text-pulse-400 transition-colors duration-200 flex items-center space-x-2 group text-sm md:text-base">
                    <ArrowRight className="w-3 h-3 md:w-4 md:h-4 transform group-hover:translate-x-1 transition-transform duration-200" />
                    <span>CRGO Slit Coils</span>
                  </Link>
                </li>
                <li>
                  <Link href="/products/crgo-lamination" className="text-gray-300 hover:text-pulse-400 transition-colors duration-200 flex items-center space-x-2 group text-sm md:text-base">
                    <ArrowRight className="w-3 h-3 md:w-4 md:h-4 transform group-hover:translate-x-1 transition-transform duration-200" />
                    <span>CRGO Laminations</span>
                  </Link>
                </li>
                <li>
                  <Link href="/products/crgo-core-assembly" className="text-gray-300 hover:text-pulse-400 transition-colors duration-200 flex items-center space-x-2 group text-sm md:text-base">
                    <ArrowRight className="w-3 h-3 md:w-4 md:h-4 transform group-hover:translate-x-1 transition-transform duration-200" />
                    <span>Core Assemblies</span>
                  </Link>
                </li>
              </ul>
            </div>
            
            {/* Let's Connect */}
            <div className="md:col-span-2 lg:col-span-1 space-y-4 md:space-y-6">
              <h4 className="text-base md:text-lg font-bold text-white relative">
                Let's Connect
                <div className="absolute -bottom-1 left-0 w-8 h-0.5 bg-pulse-500 rounded-full"></div>
              </h4>
              <div className="space-y-3 md:space-y-4">
                <div className="flex items-start space-x-3 group">
                  <div className="w-8 h-8 md:w-10 md:h-10 bg-gray-800 rounded-lg flex items-center justify-center flex-shrink-0 group-hover:bg-pulse-500 transition-colors duration-200">
                    <Phone className="w-4 h-4 md:w-5 md:h-5 text-pulse-400 group-hover:text-white" />
                  </div>
                  <div>
                    <p className="text-white font-medium text-sm md:text-base">Call Us</p>
                    <p className="text-gray-300 text-xs md:text-sm leading-relaxed">
                      <a href="tel:+919971856222" className="hover:text-pulse-400 transition-colors">+91 9971856222</a><br />
                      <a href="tel:+919667476222" className="hover:text-pulse-400 transition-colors">+91 9667476222</a>
                    </p>
                  </div>
                </div>

                <div className="flex items-start space-x-3 group">
                  <div className="w-8 h-8 md:w-10 md:h-10 bg-gray-800 rounded-lg flex items-center justify-center flex-shrink-0 group-hover:bg-pulse-500 transition-colors duration-200">
                    <Mail className="w-4 h-4 md:w-5 md:h-5 text-pulse-400 group-hover:text-white" />
                  </div>
                  <div>
                    <p className="text-white font-medium text-sm md:text-base">Email &amp; Web</p>
                    <p className="text-gray-300 text-xs md:text-sm leading-relaxed">
                      <a href="mailto:info@metfluxelectrical.com" className="hover:text-pulse-400 transition-colors">info@metfluxelectrical.com</a><br />
                      <a href="https://www.metfluxelectrical.com" className="hover:text-pulse-400 transition-colors">www.metfluxelectrical.com</a>
                    </p>
                  </div>
                </div>

              </div>
            </div>
          </div>
        </div>
        
        {/* Bottom Bar */}
        <div className="border-t border-gray-700/50 backdrop-blur-sm">
          <div className="section-container py-4 md:py-6">
            <div className="flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0">
              <div className="text-center md:text-left">
                <p className="text-gray-400 text-xs md:text-sm">
                  &copy; 2025 Metflux Electrical Industries. All rights reserved.
                </p>
              </div>
              
              <div className="flex flex-wrap items-center justify-center gap-3 md:gap-6 text-xs md:text-sm">
                <a href="#" className="text-gray-400 hover:text-pulse-400 transition-colors duration-200 flex items-center space-x-1 group">
                  <span>Privacy Policy</span>
                  <ExternalLink className="w-2 h-2 md:w-3 md:h-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
                </a>
                <span className="text-gray-600 hidden sm:inline">|</span>
                <a href="#" className="text-gray-400 hover:text-pulse-400 transition-colors duration-200 flex items-center space-x-1 group">
                  <span>Terms of Service</span>
                  <ExternalLink className="w-2 h-2 md:w-3 md:h-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
                </a>
                <span className="text-gray-600 hidden sm:inline">|</span>
                <a href="#" className="text-gray-400 hover:text-pulse-400 transition-colors duration-200 flex items-center space-x-1 group">
                  <span>Cookie Policy</span>
                  <ExternalLink className="w-2 h-2 md:w-3 md:h-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
