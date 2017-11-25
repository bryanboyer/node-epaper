gpio unexportall
gpio export 23 in # /TC_EN (1=disabled 0=enabled)
gpio export 18 high
sleep 1
gpio export 18 low #to enable /TC_EN
sleep 1 # for setup and initialization of TCON
echo "Pins exported using gpio"
