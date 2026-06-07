import React, { useState, useEffect, useRef } from "react";
import { Mail, Phone, Globe, MapPin, Send, User, MessageSquare, Building, Package, CheckCircle, AlertCircle } from "lucide-react";
import siteData from "@/data/siteData";

const ConnectSection = () => {
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    company: "",
    subject: "",
    message: "",
    inquiryType: "general"
  });
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [isVisible, setIsVisible] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true);
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

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    // Clear status when user starts typing
    if (submitStatus !== 'idle') {
      setSubmitStatus('idle');
      setStatusMessage('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitStatus('idle');
    setStatusMessage('');

    try {
      const response = await fetch('/api/public/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: `${formData.firstName} ${formData.lastName}`,
          email: formData.email,
          phone: formData.phone,
          company: formData.company,
          subject: formData.subject,
          message: formData.message,
          formType: 'connect'
        }),
      });

      const data = await response.json();

      if (data.success) {
        setSubmitStatus('success');
        setStatusMessage('Thank you for your message! We have received your inquiry and will get back to you soon.');
        
        // Reset form
        setFormData({
          firstName: "",
          lastName: "",
          email: "",
          phone: "",
          company: "",
          subject: "",
          message: "",
          inquiryType: "general"
        });
        
        // Clear status message after 5 seconds
        setTimeout(() => {
          setSubmitStatus('idle');
          setStatusMessage('');
        }, 5000);
      } else {
        setSubmitStatus('error');
        setStatusMessage(data.error || 'Something went wrong. Please try again.');
      }
    } catch (error) {
      console.error('Error submitting form:', error);
      setSubmitStatus('error');
      setStatusMessage('Network error. Please check your connection and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="w-full py-12 md:py-16 bg-gradient-to-br from-gray-900 via-gray-800 to-black" id="connect" ref={sectionRef}>
      <div className="container px-6 lg:px-8 mx-auto">
        {/* Section Header */}
        <div className="text-center mb-12">
          
          <h2 className="section-title text-3xl sm:text-4xl md:text-5xl font-display font-bold mb-6 text-white">
            Let's Connect
          </h2>
          <p className="text-xl text-gray-300 leading-relaxed max-w-4xl mx-auto">
            Ready to transform your power infrastructure with our premium transformer cores and electrical solutions? 
            We're here to help you with custom engineering, project consultation, and tailored solutions that meet 
            your specific requirements.
          </p>
        </div>

        {/* Two Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16 max-w-7xl mx-auto">
          {/* Left Side - Factory Address + contacts */}
          <div className={`transition-all duration-1000 transform ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'
          }`}>
            <div className="space-y-6">
              <div>
                <h3 className="text-2xl font-bold text-white mb-3">Our Factory Location</h3>
                <p className="text-gray-300">
                  Visit us at our state-of-the-art manufacturing facility. Site visits and tours are welcome by appointment.
                </p>
              </div>

              {/* Factory Address */}
              <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50">
                <div className="flex items-start space-x-4">
                  <div className="w-10 h-10 bg-pulse-500 rounded-lg flex items-center justify-center flex-shrink-0">
                    <MapPin className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h4 className="text-white font-semibold text-lg mb-2">Factory Address</h4>
                    <p className="text-gray-300 text-sm leading-relaxed">
                      Plot No. 290, Sector 57, Phase IV,<br />
                      HSIIDC Kundli Industrial Area,<br />
                      Sonepat, Haryana &mdash; 131028
                    </p>
                  </div>
                </div>
              </div>

              {/* Phone */}
              <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50">
                <div className="flex items-start space-x-4">
                  <div className="w-10 h-10 bg-pulse-500 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Phone className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h4 className="text-white font-semibold text-lg mb-2">Call Us</h4>
                    <p className="text-gray-300 text-sm leading-relaxed">
                      <a href="tel:+919971856222" className="hover:text-pulse-400 transition-colors">+91 9971856222</a><br />
                      <a href="tel:+919667476222" className="hover:text-pulse-400 transition-colors">+91 9667476222</a>
                    </p>
                  </div>
                </div>
              </div>

              {/* Email + Web */}
              <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50">
                <div className="flex items-start space-x-4">
                  <div className="w-10 h-10 bg-pulse-500 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Mail className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h4 className="text-white font-semibold text-lg mb-2">Email &amp; Web</h4>
                    <p className="text-gray-300 text-sm leading-relaxed">
                      <a href={`mailto:${siteData.site.email}`} className="hover:text-pulse-400 transition-colors">{siteData.site.email}</a><br />
                      <a href={siteData.site.url} className="hover:text-pulse-400 transition-colors">{siteData.site.url.replace('https://', '')}</a>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Side - Contact Form */}
          <div className={`transition-all duration-1000 transform ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'
          }`}>
            <div className="bg-white rounded-lg p-4 border-2 border-pulse-500 shadow-lg">
            <h3 className="text-lg font-bold mb-3 text-gray-900">Send us a Message</h3>
            {/* Status Message */}
            {submitStatus !== 'idle' && (
              <div className={`mb-6 p-4 rounded-lg border flex items-center gap-3 ${
                submitStatus === 'success' 
                  ? 'bg-pulse-50 border-pulse-200 text-pulse-800'
                  : 'bg-red-50 border-red-200 text-red-800'
              }`}>
                {submitStatus === 'success' ? (
                  <CheckCircle className="w-5 h-5 flex-shrink-0" />
                ) : (
                  <AlertCircle className="w-5 h-5 flex-shrink-0" />
                )}
                <p className="text-sm">{statusMessage}</p>
              </div>
            )}
            
            <form onSubmit={handleSubmit} className="space-y-3">
              {/* Name Fields Row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="firstName" className="block text-xs font-medium text-gray-700 mb-1">
                    First Name *
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <User className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                      type="text"
                      id="firstName"
                      name="firstName"
                      value={formData.firstName}
                      onChange={handleInputChange}
                      required
                      className="w-full pl-8 pr-3 py-2 bg-white border border-gray-300 rounded-md text-sm text-gray-900 placeholder-gray-500 focus:ring-2 focus:ring-pulse-500 focus:border-transparent transition-all duration-200"
                      placeholder="John"
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="lastName" className="block text-xs font-medium text-gray-700 mb-1">
                    Last Name *
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <User className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                      type="text"
                      id="lastName"
                      name="lastName"
                      value={formData.lastName}
                      onChange={handleInputChange}
                      required
                      className="w-full pl-8 pr-3 py-2 bg-white border border-gray-300 rounded-md text-sm text-gray-900 placeholder-gray-500 focus:ring-2 focus:ring-pulse-500 focus:border-transparent transition-all duration-200"
                      placeholder="Doe"
                    />
                  </div>
                </div>
              </div>

              {/* Email Field */}
              <div>
                <label htmlFor="email" className="block text-xs font-medium text-gray-700 mb-1">
                  Email Address *
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Mail className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    required
                    className="w-full pl-8 pr-3 py-2 bg-white border border-gray-300 rounded-md text-sm text-gray-900 placeholder-gray-500 focus:ring-2 focus:ring-pulse-500 focus:border-transparent transition-all duration-200"
                    placeholder="Enter your email address"
                  />
                </div>
              </div>

              {/* Phone and Company Row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="phone" className="block text-xs font-medium text-gray-700 mb-1">
                    Phone Number *
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Phone className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                      type="tel"
                      id="phone"
                      name="phone"
                      value={formData.phone}
                      onChange={handleInputChange}
                      required
                      className="w-full pl-8 pr-3 py-2 bg-white border border-gray-300 rounded-md text-sm text-gray-900 placeholder-gray-500 focus:ring-2 focus:ring-pulse-500 focus:border-transparent transition-all duration-200"
                      placeholder="+91 12345 67890"
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="company" className="block text-xs font-medium text-gray-700 mb-1">
                    Company
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Building className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                      type="text"
                      id="company"
                      name="company"
                      value={formData.company}
                      onChange={handleInputChange}
                      className="w-full pl-8 pr-3 py-2 bg-white border border-gray-300 rounded-md text-sm text-gray-900 placeholder-gray-500 focus:ring-2 focus:ring-pulse-500 focus:border-transparent transition-all duration-200"
                      placeholder="Your company name"
                    />
                  </div>
                </div>
              </div>
              
              {/* Subject and Inquiry Type Row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="subject" className="block text-xs font-medium text-gray-700 mb-1">
                    Subject *
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <MessageSquare className="h-4 w-4 text-gray-400" />
                    </div>
                    <input
                      type="text"
                      id="subject"
                      name="subject"
                      value={formData.subject}
                      onChange={handleInputChange}
                      required
                      className="w-full pl-8 pr-3 py-2 bg-white border border-gray-300 rounded-md text-sm text-gray-900 placeholder-gray-500 focus:ring-2 focus:ring-pulse-500 focus:border-transparent transition-all duration-200"
                      placeholder="Brief subject"
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="inquiryType" className="block text-xs font-medium text-gray-700 mb-1">
                    Inquiry Type
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Package className="h-4 w-4 text-gray-400" />
                    </div>
                    <select
                      id="inquiryType"
                      name="inquiryType"
                      value={formData.inquiryType}
                      onChange={handleInputChange}
                      className="w-full pl-8 pr-3 py-2 bg-white border border-gray-300 rounded-md text-sm text-gray-900 focus:ring-2 focus:ring-pulse-500 focus:border-transparent transition-all duration-200 appearance-none"
                    >
                      <option value="general">General</option>
                      <option value="product">Product Info</option>
                      <option value="support">Support</option>
                      <option value="partnership">Partnership</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Message Field */}
              <div>
                <label htmlFor="message" className="block text-xs font-medium text-gray-700 mb-1">
                  Message *
                </label>
                <div className="relative">
                  <div className="absolute top-2 left-3 pointer-events-none">
                    <MessageSquare className="h-4 w-4 text-gray-400" />
                  </div>
                  <textarea
                    id="message"
                    name="message"
                    value={formData.message}
                    onChange={handleInputChange}
                    required
                    rows={3}
                    className="w-full pl-8 pr-3 py-2 bg-white border border-gray-300 rounded-md text-sm text-gray-900 placeholder-gray-500 focus:ring-2 focus:ring-pulse-500 focus:border-transparent transition-all duration-200 resize-none"
                    placeholder="Tell us about your requirements..."
                  />
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isSubmitting}
                className={`w-full bg-gradient-to-r from-pulse-500 to-pulse-600 text-white py-2 px-4 rounded-md text-sm font-semibold hover:from-pulse-600 hover:to-pulse-700 focus:ring-2 focus:ring-pulse-500 focus:ring-offset-2 focus:ring-offset-white transition-all duration-200 flex items-center justify-center space-x-2 transform hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100`}
              >
                {isSubmitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Sending...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    <span>Send Message</span>
                  </>
                )}
              </button>
            </form>

            <p className="text-gray-500 text-xs mt-3 text-center">
              We'll get back to you within 24 hours during business days.
            </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default ConnectSection;
