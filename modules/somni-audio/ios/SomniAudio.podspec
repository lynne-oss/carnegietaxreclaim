require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'SomniAudio'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.homepage       = 'https://expo.io'
  s.license        = { :type => 'MIT' }
  s.authors        = 'Expo'
  s.platform       = :ios, '16.0'
  s.swift_version  = '5.4'
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
